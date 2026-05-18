const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet', 'starvation'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: intakeRaw } = await supabase.storage
      .from('clients')
      .download(`intakes/${client.lead_id}.json`);

    let intake = {};
    if (intakeRaw) {
      try {
        const text = await intakeRaw.text();
        intake = JSON.parse(text);
      } catch (_) {}
    }

    const anthropic = new Anthropic();

    const systemPrompt = `You are a NASM-certified fitness program architect working for Fitness by Maddy.
You create weekly workout and nutrition plans that are:
- Science-backed and evidence-based
- Personalized to the client's data and progress
- Progressive (building on previous weeks)
- Safe and sustainable (no extreme approaches)
- Clear and actionable

Output ONLY valid JSON with this exact structure:
{
  "workout_plan": {
    "overview": "brief week overview",
    "days": [
      {
        "day": "Monday",
        "focus": "muscle group",
        "exercises": [
          { "name": "exercise", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
        ]
      }
    ],
    "cardio": "cardio recommendation",
    "rest_days": "recovery guidance"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meal_timing": "guidance",
    "meals": [
      { "meal": "Breakfast", "options": ["option1", "option2"] }
    ],
    "hydration": "water guidance",
    "supplements": "if any"
  },
  "notes": "week-specific coaching notes"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Goal: ${intake.goal || 'general fitness'}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Experience: ${intake.experience_level || 'intermediate'}
- Diet preference: ${intake.diet_pref || 'no restrictions'}
- Injuries/conditions: ${intake.injuries || 'none reported'}
- Schedule: ${intake.schedule || 'flexible'}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')
  : 'No check-ins yet (first week)'}

Create a progressive, personalized Week ${week_no} plan.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await notifyMaddy('Program generation failed', `Client: ${client.name}\nWeek: ${week_no}\nReason: No JSON in Claude response`);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const programStr = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => programStr.includes(flag));
    if (flagged) {
      await notifyMaddy(
        'SAFETY FLAG: Program halted',
        `Client: ${client.name}\nWeek: ${week_no}\nProgram contains potentially unsafe content. Please review manually.`
      );
      return res.status(200).json({ flagged: true, reason: 'Safety review needed' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: pdfUrlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrlData.publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    }).select().single();

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      programData.notes || 'New week, new gains!'
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrlData.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(10).fillColor(gold)
      .text('FITNESS BY MADDY', 50, 30, { characterSpacing: 4 });
    doc.fontSize(28).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55);
    doc.fontSize(12).fillColor(gold)
      .text(`${client.name} | ${client.program?.toUpperCase().replace('_', ' ')}`, 50, 90);

    doc.moveDown(3);

    // Workout Plan
    doc.fontSize(18).fillColor(charcoal).text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
    doc.moveDown(0.5);

    if (programData.workout_plan?.overview) {
      doc.fontSize(11).fillColor('#6B6B6B').text(programData.workout_plan.overview, 50);
      doc.moveDown(0.5);
    }

    const days = programData.workout_plan?.days || [];
    for (const day of days) {
      if (doc.y > 680) { doc.addPage(); doc.y = 50; }

      doc.fontSize(13).fillColor(gold).text(`${day.day} - ${day.focus}`, 50);
      doc.moveDown(0.3);

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        doc.fontSize(10).fillColor(charcoal)
          .text(`  ${ex.name}`, 60, doc.y, { continued: true })
          .fillColor('#6B6B6B')
          .text(`  ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`);
      }
      doc.moveDown(0.5);
    }

    if (programData.workout_plan?.cardio) {
      doc.fontSize(11).fillColor(charcoal).text('Cardio: ', 50, doc.y, { continued: true })
        .fillColor('#6B6B6B').text(programData.workout_plan.cardio);
    }

    // Nutrition Plan
    if (doc.y > 550) doc.addPage();
    doc.moveDown(2);
    doc.fontSize(18).fillColor(charcoal).text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
    doc.moveDown(0.5);

    const np = programData.nutrition_plan || {};
    if (np.calories) {
      doc.fontSize(12).fillColor(charcoal)
        .text(`Daily Targets: ${np.calories} cal | ${np.protein_g}g protein | ${np.carbs_g}g carbs | ${np.fat_g}g fat`, 50);
      doc.moveDown(0.5);
    }

    const meals = np.meals || [];
    for (const meal of meals) {
      if (doc.y > 700) { doc.addPage(); doc.y = 50; }
      doc.fontSize(11).fillColor(gold).text(meal.meal, 50);
      const options = meal.options || [];
      for (const opt of options) {
        doc.fontSize(10).fillColor('#6B6B6B').text(`  - ${opt}`, 60);
      }
      doc.moveDown(0.3);
    }

    if (np.hydration) {
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor(charcoal).text('Hydration: ', 50, doc.y, { continued: true })
        .fillColor('#6B6B6B').text(np.hydration);
    }

    // Notes
    if (programData.notes) {
      doc.moveDown(2);
      doc.fontSize(14).fillColor(charcoal).text('COACHING NOTES', 50);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#6B6B6B').text(programData.notes, 50);
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#CCCCCC')
      .text('This program is designed specifically for you. Do not share or redistribute.', 50, doc.y, { align: 'center' });
    doc.text('Fitness by Maddy | fitnessbymaddy.com', { align: 'center' });

    doc.end();
  });
}
