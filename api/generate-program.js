const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { isHinglish } = require('./_lib/market');
const { notifyMaddy, maskPhone } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800',
  'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'crash diet',
  'banned substance', 'sarm'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
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

  const { data: lead } = client.lead_id
    ? await supabase.from('leads').select('*').eq('id', client.lead_id).single()
    : { data: null };

  const anthropic = new Anthropic();

  const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You design safe, effective, science-backed weekly workout and nutrition plans.

Rules:
- Never recommend calorie intake below 1200 for women or 1500 for men
- Never recommend banned substances, steroids, or dangerous supplements
- Never promise unrealistic results (max 0.5-1kg fat loss per week is healthy)
- Always include rest days and recovery protocols
- Adjust based on compliance scores and energy levels from check-ins
- Be specific: exact exercises, sets, reps, rest times, and meal plans`;

  const userPrompt = `Generate Week ${week_no} program for this client:

Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

${recentCheckins && recentCheckins.length > 0 ? `Recent Check-ins:
${recentCheckins.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins yet (Week 1).'}

Return a JSON object with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [{ "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }] },
      ...
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "cardio": { "frequency": "3x/week", "type": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] },
      ...
    ],
    "supplements": ["..."],
    "hydration": "3L minimum"
  },
  "weekly_focus": "...",
  "coach_notes": "..."
}`;

  let aiResponse;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    aiResponse = message.content[0].text;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(500).json({ error: 'AI generation failed' });
  }

  let programData;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('JSON parse error:', err.message);
    return res.status(500).json({ error: 'Failed to parse program' });
  }

  const fullText = JSON.stringify(programData).toLowerCase();
  const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
  if (flagged) {
    await notifyMaddy(
      'Program safety flag',
      `Client: ${maskPhone(client.phone)} | Week ${week_no} | AI output flagged for review`
    );
    return res.status(200).json({
      action: 'flagged_for_review',
      message: 'Program flagged for manual review'
    });
  }

  const pdfBuffer = await generatePDF(client, week_no, programData);

  const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
  const { error: uploadErr } = await supabase.storage
    .from('clients')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  let pdfUrl = null;
  if (!uploadErr) {
    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);
    pdfUrl = urlData.publicUrl;
  }

  await supabase.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.coach_notes || programData.weekly_focus
  });

  const market = lead?.market || 'GLOBAL';
  const params = isHinglish(market)
    ? [client.name || 'there', `Week ${week_no}`, programData.weekly_focus || 'New week, new gains!']
    : [client.name || 'there', `Week ${week_no}`, programData.weekly_focus || 'New week, new gains!'];

  const waResult = await sendTemplate(client.phone, 'weekly_program', params, true);

  if (waResult && !waResult.error) {
    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);
  }

  return res.status(200).json({
    action: 'program_generated',
    week_no,
    pdf_url: pdfUrl
  });
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');
    doc.fontSize(28).fill('#D4AF7A').text('FITNESS BY MADDY', 50, 40);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 75);
    doc.fontSize(10).fill('#999999')
      .text(`Prepared for ${client.name || 'Client'} | ${new Date().toLocaleDateString()}`, 50, 95);

    doc.moveDown(3);

    doc.fontSize(18).fill('#1a1a1a').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#D4AF7A');
    doc.moveDown(0.5);

    if (programData.workout_plan?.days) {
      for (const day of programData.workout_plan.days) {
        if (doc.y > 700) doc.addPage();

        doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60);
            if (ex.notes) {
              doc.fontSize(8).fill('#6B6B6B').text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (programData.workout_plan?.cardio) {
      doc.moveDown(0.5);
      doc.fontSize(11).fill('#B8965A').text('Cardio', 50);
      const c = programData.workout_plan.cardio;
      doc.fontSize(10).fill('#2C2C2C')
        .text(`  ${c.frequency} | ${c.type} | ${c.duration}`, 60);
    }

    doc.addPage();

    doc.rect(0, 0, doc.page.width, 60).fill('#1a1a1a');
    doc.fontSize(18).fill('#D4AF7A').text('NUTRITION PLAN', 50, 20);

    doc.moveDown(2);

    if (programData.nutrition_plan) {
      const np = programData.nutrition_plan;
      doc.fontSize(12).fill('#1a1a1a').text('Daily Targets', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill('#2C2C2C')
        .text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 60);
      doc.moveDown(0.8);

      if (np.meals) {
        doc.fontSize(12).fill('#1a1a1a').text('Meal Plan', 50);
        doc.moveDown(0.3);
        for (const meal of np.meals) {
          doc.fontSize(11).fill('#B8965A').text(meal.meal, 60);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill('#2C2C2C').text(`  • ${opt}`, 70);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.supplements && np.supplements.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(12).fill('#1a1a1a').text('Supplements', 50);
        doc.moveDown(0.3);
        for (const supp of np.supplements) {
          doc.fontSize(9).fill('#2C2C2C').text(`  • ${supp}`, 70);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill('#2C2C2C').text(`Hydration: ${np.hydration}`, 60);
      }
    }

    if (programData.coach_notes) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#D4AF7A');
      doc.moveDown(0.5);
      doc.fontSize(12).fill('#1a1a1a').text("Coach's Notes", 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill('#2C2C2C').text(programData.coach_notes, 60, doc.y, { width: 480 });
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#999999')
      .text('© Fitness by Maddy | fitnessbymaddy.com | This program is personalized — do not share.', 50, doc.y, { align: 'center', width: 495 });

    doc.end();
  });
}
