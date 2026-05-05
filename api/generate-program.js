const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in a week', 'crash diet'
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: intake } = await db.from('lead_intake').select('*').eq('lead_id', client.lead_id).single();

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are an elite fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans based on client data.
Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]}
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fats_g": 60,
    "meal_timing": ["..."],
    "sample_day": { "meal_1": "...", "meal_2": "...", "meal_3": "...", "snacks": "..." },
    "hydration": "...",
    "supplements": ["..."]
  },
  "weekly_focus": "...",
  "notes_for_client": "..."
}
Never recommend extreme calorie deficits (<1200 for women, <1500 for men).
Never recommend banned substances or unrealistic timelines.
Tailor to the client's equipment access, injuries, and preferences.`;

  const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intake ? `
- Age: ${intake.age}
- Gender: ${intake.gender}
- Height: ${intake.height}
- Current Weight: ${intake.weight}kg
- Goal: ${intake.goal}
- Injuries: ${intake.injuries || 'None'}
- Diet Preference: ${intake.diet_preference || 'No restrictions'}
- Training Days/Week: ${intake.training_days || 5}
- Wake Time: ${intake.wake_time || '7am'}
- Medical Conditions: ${intake.medical_conditions || 'None'}
` : '- No intake form data available yet'}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : 'No previous check-ins (first week)'}

Generate a progressive, safe, effective program for Week ${week_no}.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const rawContent = response.content[0].text;

  if (hasSafetyIssue(rawContent)) {
    const { escalateToMaddy } = require('./lib/escalate');
    await escalateToMaddy('Safety flag in generated program', {
      phone: client.phone,
      message: `Week ${week_no} program flagged for review`
    });
    return res.status(200).json({ action: 'flagged_for_review' });
  }

  let programData;
  try {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    programData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[GENERATE] JSON parse error');
    return res.status(500).json({ error: 'Failed to parse program' });
  }

  const pdfBuffer = await generatePDF(client, week_no, programData);

  const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
  await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true
  });

  const { data: publicUrl } = db.storage.from('programs').getPublicUrl(pdfPath);

  const { error: insertError } = await db.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    generated_at: new Date().toISOString(),
    pdf_url: publicUrl.publicUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.notes_for_client
  });

  if (insertError) {
    console.error('[GENERATE] DB insert error:', insertError.message);
  }

  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    `Week ${week_no}`,
    programData.weekly_focus || 'Keep pushing!',
    publicUrl.publicUrl
  ]);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString()
  }).eq('client_id', client_id).eq('week_no', week_no);

  return res.status(200).json({ success: true, pdf_url: publicUrl.publicUrl });
};

async function generatePDF(client, weekNo, data) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.rect(0, 0, 595, 842).fill('#1a1a1a');

    doc.fillColor('#B8965A')
       .fontSize(28)
       .font('Helvetica-Bold')
       .text('FITNESS BY MADDY', 50, 40, { align: 'center' });

    doc.fillColor('#ffffff')
       .fontSize(20)
       .text(`WEEK ${weekNo} PROGRAM`, 50, 80, { align: 'center' });

    doc.fillColor('#B8965A')
       .fontSize(12)
       .text(`Client: ${client.name || 'Athlete'}`, 50, 115, { align: 'center' });

    doc.moveTo(50, 140).lineTo(545, 140).strokeColor('#B8965A').lineWidth(1).stroke();

    let y = 160;

    doc.fillColor('#B8965A').fontSize(16).font('Helvetica-Bold')
       .text('WORKOUT PLAN', 50, y);
    y += 25;

    if (data.workout_plan && data.workout_plan.days) {
      for (const day of data.workout_plan.days) {
        if (y > 750) { doc.addPage(); doc.rect(0, 0, 595, 842).fill('#1a1a1a'); y = 50; }
        doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold')
           .text(`${day.day} — ${day.focus}`, 50, y);
        y += 18;

        for (const ex of day.exercises || []) {
          if (y > 750) { doc.addPage(); doc.rect(0, 0, 595, 842).fill('#1a1a1a'); y = 50; }
          doc.fillColor('#cccccc').fontSize(10).font('Helvetica')
             .text(`• ${ex.name}: ${ex.sets}×${ex.reps} (Rest: ${ex.rest})`, 65, y);
          y += 14;
        }
        y += 8;
      }
    }

    if (y > 650) { doc.addPage(); doc.rect(0, 0, 595, 842).fill('#1a1a1a'); y = 50; }

    y += 10;
    doc.fillColor('#B8965A').fontSize(16).font('Helvetica-Bold')
       .text('NUTRITION PLAN', 50, y);
    y += 25;

    if (data.nutrition_plan) {
      const np = data.nutrition_plan;
      doc.fillColor('#ffffff').fontSize(11).font('Helvetica')
         .text(`Calories: ${np.calories} kcal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fats: ${np.fats_g}g`, 50, y);
      y += 20;

      if (np.sample_day) {
        for (const [meal, desc] of Object.entries(np.sample_day)) {
          if (y > 750) { doc.addPage(); doc.rect(0, 0, 595, 842).fill('#1a1a1a'); y = 50; }
          doc.fillColor('#cccccc').fontSize(10)
             .text(`${meal.replace('_', ' ').toUpperCase()}: ${desc}`, 65, y);
          y += 16;
        }
      }
    }

    if (data.notes_for_client) {
      y += 20;
      if (y > 720) { doc.addPage(); doc.rect(0, 0, 595, 842).fill('#1a1a1a'); y = 50; }
      doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold')
         .text('COACH NOTES:', 50, y);
      y += 18;
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica')
         .text(data.notes_for_client, 50, y, { width: 495 });
    }

    doc.end();
  });
}
