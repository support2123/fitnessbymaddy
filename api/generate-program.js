const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: intake } = await db
    .from('intake_forms')
    .select('*')
    .eq('lead_id', client.lead_id)
    .single();

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a certified fitness program architect working for Fitness by Maddy, an elite online coaching brand. Generate weekly workout and nutrition plans that are:
- Evidence-based and safe
- Progressive (building on previous weeks)
- Tailored to the client's profile, goals, and feedback
- Realistic and sustainable

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "frequency": "3x/week", "type": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": ["..."],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coach note for the client"
}

NEVER recommend extreme calorie deficits (<1200 for women, <1500 for men), banned substances, or unrealistic timelines.`;

  const userPrompt = buildUserPrompt(client, intake, recentCheckins, week_no);

  let programJson;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programJson = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  const fullText = JSON.stringify(programJson).toLowerCase();
  const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
  if (flagged) {
    await escalateToMaddy(
      'Program flagged for safety review',
      client.phone,
      `Week ${week_no} program contains potentially risky content`
    );
    return res.status(200).json({ ok: true, flagged: true, awaiting_review: true });
  }

  const pdfBuffer = await generatePDF(client, programJson, week_no);
  const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;

  await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });

  const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);
  const pdfUrl = urlData.publicUrl;

  await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    whatsapp_sent_at: null,
    workout_plan: programJson.workout_plan,
    nutrition_plan: programJson.nutrition_plan,
    notes: programJson.notes,
  });

  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no),
    programJson.notes || 'Your new program is ready!',
  ], pdfUrl);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('client_id', client_id).eq('week_no', week_no);

  return res.status(200).json({ ok: true, pdf_url: pdfUrl });
};

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for:\n`;
  prompt += `Name: ${client.name}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'unknown'}\n`;
    prompt += `Goal: ${intake.goal || 'general fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'none reported'}\n`;
    prompt += `Diet preference: ${intake.diet_pref || 'no preference'}\n`;
    prompt += `Schedule: ${intake.schedule || 'flexible'}\n`;
    prompt += `Experience: ${intake.workout_experience || 'intermediate'}\n`;
    prompt += `Medical: ${intake.medical_conditions || 'none'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += '\nRecent check-ins:\n';
    checkins.forEach(c => {
      prompt += `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, `;
      prompt += `compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      prompt += '\n';
    });
  }

  if (weekNo > 1) {
    prompt += `\nThis is week ${weekNo} — progressively increase intensity from previous weeks.`;
  }

  return prompt;
}

async function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fillColor('#D4AF7A')
      .text(`${client.name || 'Client'} | ${client.program}`, 50, 95, { align: 'center' });

    doc.moveDown(3);

    // Workout plan
    doc.fontSize(18).fillColor('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(0.5);

    if (program.workout_plan?.days) {
      program.workout_plan.days.forEach(day => {
        doc.fontSize(13).fillColor('#B8965A').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          day.exercises.forEach(ex => {
            doc.fontSize(10).fillColor('#2C2C2C')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60);
            if (ex.notes) {
              doc.fontSize(8).fillColor('#6B6B6B').text(`    ${ex.notes}`, 70);
            }
          });
        }
        doc.moveDown(0.5);
      });
    }

    if (program.workout_plan?.cardio) {
      doc.moveDown(0.5);
      const c = program.workout_plan.cardio;
      doc.fontSize(11).fillColor('#2C2C2C')
        .text(`Cardio: ${c.type} | ${c.frequency} | ${c.duration}`, 50);
    }

    // Nutrition plan
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(18).fillColor('#B8965A')
      .text('NUTRITION PLAN', 50, 30, { align: 'center' });

    doc.moveDown(3);

    if (program.nutrition_plan) {
      const np = program.nutrition_plan;
      doc.fontSize(12).fillColor('#2C2C2C');
      doc.text(`Daily Calories: ${np.calories} kcal`, 50);
      doc.text(`Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 50);
      doc.moveDown(0.5);
      doc.text(`Hydration: ${np.hydration || '3-4L water daily'}`, 50);
      doc.moveDown(0.5);

      if (np.meal_timing && np.meal_timing.length) {
        doc.fontSize(13).fillColor('#B8965A').text('Meal Timing', 50);
        doc.moveDown(0.3);
        np.meal_timing.forEach(meal => {
          doc.fontSize(10).fillColor('#2C2C2C').text(`  ${meal}`, 60);
        });
      }

      if (np.supplements && np.supplements.length) {
        doc.moveDown(0.5);
        doc.fontSize(13).fillColor('#B8965A').text('Supplements', 50);
        doc.moveDown(0.3);
        np.supplements.forEach(s => {
          doc.fontSize(10).fillColor('#2C2C2C').text(`  ${s}`, 60);
        });
      }
    }

    // Coach note
    if (program.notes) {
      doc.moveDown(1);
      doc.rect(50, doc.y, 495, 60).fillAndStroke('#FAF8F4', '#B8965A');
      doc.fontSize(10).fillColor('#2C2C2C')
        .text(program.notes, 60, doc.y - 50, { width: 475 });
    }

    // Footer
    doc.fontSize(8).fillColor('#6B6B6B')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}
