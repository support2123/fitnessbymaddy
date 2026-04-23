const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./lib/supabase');
const { sendDocument, sendText } = require('./lib/whatsapp');
const { isHinglish } = require('./lib/market');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*cal/i, /extreme\s*cut/i,
  /starvation/i, /clenbuterol/i, /dnp/i, /ephedrine/i,
  /steroids?/i, /sarms?/i, /hgh/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified program architect for FitnessByMaddy, an elite online coaching brand.
You create weekly workout and nutrition plans that are:
- Evidence-based and progressive
- Tailored to the client's check-in data
- Safe (no extreme calorie deficits below 1200 for women / 1500 for men)
- No banned substances or unrealistic timelines
- Warm, motivating tone

Output strictly valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS or HIIT", "duration": "20-30 min" }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option A description", "Option B description"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "coach_note": "Brief 2-line motivational note for the client"
}`;

    const userPrompt = buildUserPrompt(client, recentCheckins, prevPrograms, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = message.content[0].text;
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Claude response parse error:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program data' });
    }

    const fullText = JSON.stringify(programData);
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(fullText)) {
        await supabase.from('escalations').insert({
          phone: client.phone,
          client_id: client.id,
          reason: `Unsafe content detected in generated program: ${pattern}`,
          message_body: fullText.substring(0, 500)
        });
        return res.status(400).json({ error: 'Program flagged for safety review' });
      }
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client.id}/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData?.publicUrl || '';

    const { error: progErr } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note
      });

    if (progErr) {
      console.error('Program insert error:', progErr.message);
    }

    if (pdfUrl) {
      const hinglish = isHinglish(client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL');
      const caption = hinglish
        ? `Week ${week_no} ka program ready hai! Check karo aur questions ho toh batao.`
        : `Your Week ${week_no} program is ready! Check it out and let us know if you have questions.`;

      await sendDocument(client.phone, pdfUrl, caption);

      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({ ok: true, week_no, pdfUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, checkins, prevPrograms, weekNo) {
  let prompt = `Generate Week ${weekNo} program for client:\n`;
  prompt += `- Program: ${client.program}\n`;
  prompt += `- Name: ${client.name || 'Client'}\n`;
  prompt += `- Started: ${client.program_started_at}\n\n`;

  if (checkins?.length > 0) {
    prompt += `Recent check-ins:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, ` +
        `compliance=${c.compliance_score}/10, energy=${c.energy}/10` +
        (c.issues ? `, issues: ${c.issues}` : '') +
        (c.next_week_focus ? `, focus: ${c.next_week_focus}` : '') + `\n`;
    }
  } else {
    prompt += `No check-in data yet (first week).\n`;
  }

  if (prevPrograms?.length > 0) {
    const prev = prevPrograms[0];
    prompt += `\nPrevious week ${prev.week_no} plan summary:\n`;
    if (prev.notes) prompt += `  Coach note: ${prev.notes}\n`;
  }

  prompt += `\nDesign a progressive, safe, and effective plan for this week. Adjust based on check-in data.`;
  return prompt;
}

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 72);
    doc.fontSize(10).fillColor('#D4AF7A')
      .text(`${client.name || 'Client'} | ${client.program}`, 50, 92);

    doc.moveDown(3);

    doc.fillColor('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').stroke();
    doc.moveDown(0.5);

    if (programData.workout_plan?.days) {
      for (const day of programData.workout_plan.days) {
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#2C2C2C')
          .text(`${day.day} — ${day.focus}`);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).font('Helvetica').fillColor('#444444')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}` +
                (ex.notes ? `  |  ${ex.notes}` : ''), { indent: 10 });
          }
        }
        doc.moveDown(0.5);
      }

      if (programData.workout_plan.cardio) {
        const c = programData.workout_plan.cardio;
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#2C2C2C')
          .text(`Cardio: ${c.frequency} — ${c.type} — ${c.duration}`);
      }
    }

    doc.moveDown(1.5);

    doc.fontSize(18).font('Helvetica-Bold').fillColor('#2C2C2C')
      .text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').stroke();
    doc.moveDown(0.5);

    if (programData.nutrition_plan) {
      const np = programData.nutrition_plan;
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#2C2C2C')
        .text(`Daily Targets: ${np.calories} cal  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fat_g}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).font('Helvetica-Bold').fillColor('#2C2C2C')
            .text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).font('Helvetica').fillColor('#444444')
                .text(`  • ${opt}`, { indent: 10 });
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.supplements?.length > 0) {
        doc.moveDown(0.3);
        doc.fontSize(11).font('Helvetica-Bold').text('Supplements:');
        doc.fontSize(10).font('Helvetica').fillColor('#444444')
          .text(`  ${np.supplements.join(', ')}`);
      }

      if (np.hydration) {
        doc.fontSize(10).font('Helvetica').fillColor('#444444')
          .text(`  Hydration: ${np.hydration}`);
      }
    }

    if (programData.coach_note) {
      doc.moveDown(1.5);
      doc.rect(50, doc.y, 495, 60).fill('#FAF8F4');
      doc.fontSize(11).font('Helvetica-Oblique').fillColor('#B8965A')
        .text(programData.coach_note, 65, doc.y - 45, { width: 465 });
    }

    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica').fillColor('#999999')
      .text('fitnessbymaddy.com | This program is personalised. Do not share.', 50, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}
