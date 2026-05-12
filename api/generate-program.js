const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 1000 cal', '800 cal', '500 cal',
  'clenbuterol', 'dnp', 'steroid', 'anabolic', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme fasting', 'water fast for'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intake_data')
      .select('*')
      .eq('lead_id', client.lead_id)
      .maybeSingle();

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect — an expert fitness & nutrition coach.
You create weekly workout and nutrition plans for individual clients.
Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "LISS", "duration": "30min", "frequency": "3x/week" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "suggestion": "..." }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "notes": "Brief coach note for the client",
  "next_week_focus": "Progressive overload on compounds"
}

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, SARMs, or steroids
- Never promise unrealistic timelines
- Always include progressive overload
- Adjust based on check-in compliance and energy levels
- Be warm, professional, encouraging`;

    const userPrompt = buildClientPrompt(client, intake, checkins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude did not return valid JSON');
    }

    const program = JSON.parse(jsonMatch[0]);

    const safetyCheck = checkSafety(rawText);
    if (!safetyCheck.safe) {
      await notifyMaddy(
        `Program flagged for review — ${maskPhone(client.phone)}`,
        `Week ${week_no} | Flag: "${safetyCheck.flag}"\nClient: ${client.name}`
      );
      return res.status(200).json({
        ok: false,
        flagged: true,
        reason: safetyCheck.flag,
        note: 'Sent to Maddy for manual review'
      });
    }

    const pdfBuffer = await generatePDF(client, program, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = db.storage.from('client-files').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.notes
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      program.notes || 'Your new program is ready!',
      pdfUrl
    ], true);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function buildClientPrompt(client, intake, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Unknown'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'Unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'Unknown'}\n`;
    prompt += `Goal: ${intake.goal || 'General fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'None reported'}\n`;
    prompt += `Diet preference: ${intake.diet_pref || 'No restriction'}\n`;
    prompt += `Schedule: ${intake.schedule || 'Flexible'}\n`;
    prompt += `Experience: ${intake.experience_level || 'Intermediate'}\n`;
    prompt += `Starting weight: ${intake.current_weight || 'Unknown'}kg\n`;
    prompt += `Height: ${intake.height || 'Unknown'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const ci of checkins) {
      prompt += `  Week ${ci.week_no}: weight=${ci.weight}kg, waist=${ci.waist}cm, `;
      prompt += `compliance=${ci.compliance_score}/10, energy=${ci.energy}/10`;
      if (ci.issues) prompt += `, issues: "${ci.issues}"`;
      if (ci.next_week_focus) prompt += `, focus: "${ci.next_week_focus}"`;
      prompt += `\n`;
    }
  }

  if (weekNo > 1) {
    prompt += `\nThis is week ${weekNo} — apply progressive overload where appropriate.`;
  }

  return prompt;
}

function checkSafety(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) {
      return { safe: false, flag };
    }
  }
  return { safe: true };
}

function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, { align: 'left' });

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    // Workout plan
    doc.fontSize(18).fillColor('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (program.workout_plan?.days) {
      for (const day of program.workout_plan.days) {
        doc.fontSize(13).fillColor('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fillColor('#6B6B6B')
              .text(`  • ${ex.name}: ${ex.sets} x ${ex.reps} (rest ${ex.rest})`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (program.workout_plan?.cardio) {
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#2C2C2C')
        .text(`Cardio: ${program.workout_plan.cardio.type} — ${program.workout_plan.cardio.duration}, ${program.workout_plan.cardio.frequency}`, 50);
    }

    // Nutrition plan
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN', 50, 20);

    doc.moveDown(2);
    doc.fillColor('#2C2C2C');

    if (program.nutrition_plan) {
      const np = program.nutrition_plan;
      doc.fontSize(12).text(`Daily Targets: ${np.calories} kcal | ${np.protein_g}g protein | ${np.carbs_g}g carbs | ${np.fat_g}g fat`, 50);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).fillColor('#B8965A').text(`${meal.meal} (${meal.time})`, 50);
          doc.fontSize(10).fillColor('#6B6B6B').text(`  ${meal.suggestion}`, 60);
          doc.moveDown(0.3);
        }
      }

      if (np.supplements?.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor('#2C2C2C').text('Supplements:', 50);
        for (const s of np.supplements) {
          doc.fontSize(10).fillColor('#6B6B6B').text(`  • ${s}`, 60);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#6B6B6B').text(`Hydration: ${np.hydration}`, 50);
      }
    }

    if (program.notes) {
      doc.moveDown(1);
      doc.fontSize(11).fillColor('#B8965A').text('COACH NOTES:', 50);
      doc.fontSize(10).fillColor('#2C2C2C').text(program.notes, 50);
    }

    // Footer
    doc.fontSize(8).fillColor('#C8B89A')
      .text('fitnessbymaddy.com | This program is personalised — do not share.', 50, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}
