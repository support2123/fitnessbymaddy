const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroids', 'anavar', 'testosterone',
  'lose 10kg in 1 week', 'crash diet', 'water fast'
];

function checkProgramSafety(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

async function generatePDF(workoutPlan, nutritionPlan, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(28).font('Helvetica-Bold')
      .fillColor('#B8965A')
      .text('FITNESS BY MADDY', { align: 'center' });

    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica')
      .fillColor('#6B6B6B')
      .text('Elite Online Coaching', { align: 'center' });

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(1);

    doc.fontSize(18).font('Helvetica-Bold')
      .fillColor('#2C2C2C')
      .text(`Week ${weekNo} Program — ${clientName || 'Client'}`, { align: 'center' });

    doc.moveDown(1.5);
    doc.fontSize(16).font('Helvetica-Bold')
      .fillColor('#B8965A')
      .text('WORKOUT PLAN');
    doc.moveDown(0.5);

    if (workoutPlan && typeof workoutPlan === 'object') {
      for (const [day, exercises] of Object.entries(workoutPlan)) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#2C2C2C').text(day);
        doc.fontSize(10).font('Helvetica').fillColor('#6B6B6B');
        if (Array.isArray(exercises)) {
          exercises.forEach(ex => {
            const line = typeof ex === 'string' ? ex : `${ex.name} — ${ex.sets}x${ex.reps}${ex.rest ? ` (Rest: ${ex.rest})` : ''}`;
            doc.text(`  • ${line}`);
          });
        } else {
          doc.text(`  ${JSON.stringify(exercises)}`);
        }
        doc.moveDown(0.5);
      }
    }

    doc.moveDown(1);
    doc.fontSize(16).font('Helvetica-Bold')
      .fillColor('#B8965A')
      .text('NUTRITION PLAN');
    doc.moveDown(0.5);

    if (nutritionPlan && typeof nutritionPlan === 'object') {
      for (const [meal, details] of Object.entries(nutritionPlan)) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#2C2C2C').text(meal);
        doc.fontSize(10).font('Helvetica').fillColor('#6B6B6B');
        if (typeof details === 'string') {
          doc.text(`  ${details}`);
        } else if (Array.isArray(details)) {
          details.forEach(item => doc.text(`  • ${item}`));
        } else {
          doc.text(`  ${JSON.stringify(details)}`);
        }
        doc.moveDown(0.3);
      }
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').lineWidth(1).stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).font('Helvetica').fillColor('#6B6B6B')
      .text('© Fitness by Maddy — fitnessbymaddy.com | For personal use only.', { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: existingProgram } = await db
    .from('programs')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .single();

  if (existingProgram) {
    return res.status(409).json({ error: 'Program already generated for this week' });
  }

  let intakeData = {};
  if (client.lead_id) {
    const { data: lead } = await db.from('leads').select('first_msg').eq('id', client.lead_id).single();
    try { intakeData = JSON.parse(lead?.first_msg || '{}'); } catch {}
  }

  const anthropic = new Anthropic();
  const checkinSummary = (recentCheckins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  const prompt = `You are a certified fitness program architect for FitnessByMaddy. Generate a detailed week ${week_no} training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${intakeData.age || 'unknown'}
- Goal: ${intakeData.goal || 'general fitness'}
- Injuries/conditions: ${intakeData.injuries || 'none reported'}
- Diet preference: ${intakeData.diet_preference || 'no preference'}
- Activity level: ${intakeData.current_activity_level || 'moderate'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

RULES:
- Design progressive overload from week to week
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend any banned substances or extreme protocols
- Include warm-up and cool-down in workouts
- Provide specific sets, reps, and rest periods
- Nutrition should include macros and meal timing

Return valid JSON with this exact structure:
{
  "workout_plan": {
    "Day 1 - [Focus]": [{"name": "Exercise", "sets": 3, "reps": "10-12", "rest": "60s"}],
    "Day 2 - [Focus]": [...],
    ...
  },
  "nutrition_plan": {
    "Daily Targets": "Calories: X, Protein: Xg, Carbs: Xg, Fat: Xg",
    "Meal 1 - Breakfast": ["item 1", "item 2"],
    "Meal 2 - Lunch": ["item 1", "item 2"],
    "Meal 3 - Dinner": ["item 1", "item 2"],
    "Snacks": ["item 1", "item 2"]
  },
  "notes": "Brief coach's note about this week's focus"
}`;

  let aiResponse;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });
    aiResponse = msg.content[0].text;
  } catch (e) {
    console.error('Claude API error:', e.message);
    return res.status(500).json({ error: 'AI generation failed' });
  }

  const safetyIssue = checkProgramSafety(aiResponse);
  if (safetyIssue) {
    await db.from('escalations').insert({
      phone: client.phone,
      reason: `Unsafe program content: "${safetyIssue}"`,
      message_body: `Week ${week_no} program for client ${client.id}`
    });
    await notifyMaddy('Program Safety Flag', `Week ${week_no} for ${client.phone.slice(-4)}: "${safetyIssue}"`);
    return res.status(422).json({ error: 'Program flagged for safety review', flag: safetyIssue });
  }

  let parsed;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse);
  } catch {
    return res.status(500).json({ error: 'Failed to parse AI response' });
  }

  const pdfBuffer = await generatePDF(parsed.workout_plan, parsed.nutrition_plan, client.name, week_no);

  const filePath = `${client.folder_url || `clients/${client.id}`}/week_${week_no}.pdf`;
  const { error: uploadErr } = await db.storage
    .from('programs')
    .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

  let pdfUrl = null;
  if (!uploadErr) {
    const { data: urlData } = db.storage.from('programs').getPublicUrl(filePath);
    pdfUrl = urlData?.publicUrl;
  }

  const { data: program, error: dbErr } = await db.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: parsed.workout_plan,
    nutrition_plan: parsed.nutrition_plan,
    notes: parsed.notes
  }).select().single();

  if (dbErr) {
    return res.status(500).json({ error: 'Failed to save program' });
  }

  if (pdfUrl) {
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.notes || 'Your new program is ready!'
    ], pdfUrl);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);
  }

  res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
};
