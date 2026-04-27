import Anthropic from '@anthropic-ai/sdk';
import supabase from '../lib/supabase.js';
import { sendText, notifyMaddy } from '../lib/whatsapp.js';
import { maskPhone, isHinglish, detectMarket } from '../lib/market.js';
import PDFDocument from 'pdfkit';

const SAFETY_FLAGS = [
  'extreme calorie', 'starvation', 'under 1000 cal', 'under 800 cal',
  'clenbuterol', 'dnp', 'dinitrophenol', 'anabolic steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['x-internal-key'];
  if (auth !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await supabase
      .from('lead_intakes')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create safe, effective, science-backed weekly workout and nutrition plans.
Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "..."
}
NEVER recommend extreme calorie restriction (<1200 for women, <1500 for men),
banned substances, or unrealistic timelines. If unsure, err on the side of safety.`;

    const clientContext = buildClientContext(client, checkins, intake, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: clientContext }],
    });

    const content = response.content[0]?.text || '';

    const flagged = SAFETY_FLAGS.some(f => content.toLowerCase().includes(f));
    if (flagged) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${client.name || maskPhone(client.phone)}, Week ${week_no}`
      );
      return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] || content);
    } catch {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Invalid program output' });
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const { error: dbError } = await supabase.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
    }, { onConflict: 'client_id,week_no' });

    if (dbError) {
      console.error('Program save error:', dbError.message);
    }

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const msg = hinglish
      ? `Week ${week_no} ka program ready hai! PDF check karo. Koi doubt ho toh message karo.`
      : `Your Week ${week_no} program is ready! Check the PDF. Message us if you have any questions.`;

    await sendText(client.phone, msg);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: urlData?.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
}

function buildClientContext(client, checkins, intake, weekNo) {
  let ctx = `Generate Week ${weekNo} program for client:\n`;
  ctx += `Name: ${client.name || 'Client'}\n`;
  ctx += `Program: ${client.program}\n`;

  if (intake) {
    ctx += `Age: ${intake.age || 'N/A'}\n`;
    ctx += `Goal: ${intake.goal || 'General fitness'}\n`;
    ctx += `Injuries: ${intake.injuries || 'None reported'}\n`;
    ctx += `Diet preference: ${intake.diet_pref || 'No restrictions'}\n`;
    ctx += `Schedule: ${intake.schedule || 'Flexible'}\n`;
    ctx += `Experience: ${intake.training_experience || 'Intermediate'}\n`;
    ctx += `Medical: ${intake.medical_conditions || 'None'}\n`;
  }

  if (checkins && checkins.length > 0) {
    ctx += '\nRecent check-ins:\n';
    for (const c of checkins) {
      ctx += `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) ctx += `, issues: ${c.issues}`;
      if (c.next_week_focus) ctx += `, focus: ${c.next_week_focus}`;
      ctx += '\n';
    }
  }

  if (weekNo === 1) {
    ctx += '\nThis is Week 1 — create a baseline program appropriate for their experience level.';
  } else {
    ctx += `\nThis is Week ${weekNo} — progressively adjust based on check-in data.`;
  }

  return ctx;
}

function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fillColor('#B8965A')
      .fontSize(12)
      .text('FITNESS BY MADDY', 50, 50, { characterSpacing: 4 });

    doc.fillColor('#ffffff')
      .fontSize(36)
      .text(`WEEK ${weekNo}`, 50, 90);

    doc.fillColor('#B8965A')
      .fontSize(14)
      .text(`Program: ${client.program?.toUpperCase() || '12WK'}`, 50, 140);

    doc.fillColor('#666666')
      .fontSize(10)
      .text(`Client: ${client.name || 'Client'} | Generated: ${new Date().toLocaleDateString()}`, 50, 165);

    doc.moveTo(50, 190).lineTo(545, 190).strokeColor('#B8965A').lineWidth(0.5).stroke();

    let y = 210;

    if (program.workout_plan?.days) {
      doc.fillColor('#B8965A').fontSize(18).text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of program.workout_plan.days) {
        if (y > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
          y = 50;
        }

        doc.fillColor('#ffffff').fontSize(13).text(
          `${day.day} — ${day.focus}`, 50, y
        );
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fillColor('#cccccc').fontSize(10).text(
              `  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`,
              70, y
            );
            y += 16;
          }
        }
        y += 10;
      }
    }

    if (program.nutrition_plan) {
      if (y > 600) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
        y = 50;
      }

      y += 10;
      doc.fillColor('#B8965A').fontSize(18).text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = program.nutrition_plan;
      doc.fillColor('#ffffff').fontSize(11).text(
        `Calories: ${np.calories} | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`,
        50, y
      );
      y += 25;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) {
            doc.addPage();
            doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
            y = 50;
          }
          doc.fillColor('#B8965A').fontSize(11).text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fillColor('#cccccc').fontSize(10).text(`  • ${opt}`, 70, y);
              y += 14;
            }
          }
          y += 6;
        }
      }
    }

    if (program.notes) {
      if (y > 680) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
        y = 50;
      }
      y += 20;
      doc.fillColor('#B8965A').fontSize(14).text('NOTES', 50, y);
      y += 20;
      doc.fillColor('#cccccc').fontSize(10).text(program.notes, 50, y, { width: 495 });
    }

    doc.end();
  });
}
