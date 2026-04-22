const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme deficit', 'water fast', 'zero carb',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMsg } = await supabase
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = {};
    if (intakeMsg?.body) {
      try { intakeData = JSON.parse(intakeMsg.body); } catch (e) { /* ignore */ }
    }

    const programPlan = await generateWithClaude(client, intakeData, recentCheckins || [], week_no);

    if (hasSafetyIssue(programPlan)) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation(
        client.phone, client_id,
        'Program safety flag — needs Maddy review',
        `Week ${week_no} program flagged for safety review`
      );
      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }

    const pdfBuffer = await generatePDF(client, programPlan, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || '';

    const { error: programError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programPlan.workout,
      nutrition_plan: programPlan.nutrition,
      notes: programPlan.coach_note || '',
    });

    if (programError) {
      console.error('Program insert error:', programError);
    }

    await sendWhatsApp(client.phone, 'weekly_program_v1', [
      client.name || 'Champion',
      week_no.toString(),
      programPlan.coach_note || 'New week, new gains! Check your plan.',
    ], pdfUrl);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      ok: true,
      client_id,
      week_no,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generateWithClaude(client, intakeData, checkins, weekNo) {
  const anthropic = new Anthropic();

  const checkinSummary = checkins.map((c) =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prompt = `You are the program architect for FitnessByMaddy, an elite online coaching brand.

Generate a WEEK ${weekNo} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${intakeData.age || 'unknown'}
- Gender: ${intakeData.gender || 'unknown'}
- Goal: ${intakeData.goal || 'general fitness'}
- Experience: ${intakeData.experience_level || 'intermediate'}
- Injuries/Limitations: ${intakeData.injuries || 'none'}
- Diet Preference: ${intakeData.diet_preference || 'flexible'}
- Schedule: ${intakeData.schedule || '5 days/week'}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

RULES:
- Progressive overload from previous weeks
- Realistic calorie targets (never below 1200 for women, 1500 for men)
- No banned substances or extreme protocols
- Warm, motivational tone — expert but approachable
- If issues reported, adapt the plan accordingly
- Include rest day recommendations

Return ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
    ],
    "rest_days": ["Sunday"],
    "cardio": "3x 20min LISS on rest days"
  },
  "nutrition": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 73,
    "meals": [
      { "meal": "Breakfast", "example": "4 eggs + 2 toast + avocado", "calories": 550 }
    ],
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D3"],
    "hydration": "3-4L water daily"
  },
  "coach_note": "One-liner motivational context note for the week"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude did not return valid JSON');

  return JSON.parse(jsonMatch[0]);
}

function hasSafetyIssue(plan) {
  const planStr = JSON.stringify(plan).toLowerCase();
  return SAFETY_FLAGS.some((flag) => planStr.includes(flag));
}

async function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 100).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(14).fill('#FFFFFF').font('Helvetica')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 65);

    doc.moveDown(2);
    let y = 130;

    // Coach note
    if (plan.coach_note) {
      doc.fontSize(11).fill('#B8965A').font('Helvetica-Bold')
        .text(plan.coach_note, 50, y, { width: 495 });
      y += 30;
    }

    // Workout section
    doc.fontSize(18).fill('#2C2C2C').font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (plan.workout?.days) {
      for (const day of plan.workout.days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill('#B8965A').font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#2C2C2C').font('Helvetica')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 50, y);
            y += 16;
            if (ex.notes) {
              doc.fontSize(9).fill('#6B6B6B')
                .text(`    ${ex.notes}`, 50, y);
              y += 14;
            }
          }
        }
        y += 10;
      }
    }

    if (plan.workout?.cardio) {
      if (y > 720) { doc.addPage(); y = 50; }
      doc.fontSize(11).fill('#2C2C2C').font('Helvetica-Bold')
        .text('Cardio: ', 50, y, { continued: true })
        .font('Helvetica').text(plan.workout.cardio);
      y += 25;
    }

    // Nutrition section
    if (y > 620) { doc.addPage(); y = 50; }
    y += 10;
    doc.fontSize(18).fill('#2C2C2C').font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (plan.nutrition) {
      const n = plan.nutrition;
      doc.fontSize(11).fill('#2C2C2C').font('Helvetica-Bold')
        .text(`Daily Targets: ${n.calories} kcal  |  P: ${n.protein_g}g  |  C: ${n.carbs_g}g  |  F: ${n.fat_g}g`, 50, y);
      y += 25;

      if (n.meals) {
        for (const meal of n.meals) {
          if (y > 740) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill('#B8965A').font('Helvetica-Bold')
            .text(`${meal.meal} (~${meal.calories} kcal)`, 50, y);
          y += 16;
          doc.fontSize(10).fill('#2C2C2C').font('Helvetica')
            .text(`  ${meal.example}`, 50, y);
          y += 18;
        }
      }

      if (n.supplements) {
        y += 5;
        doc.fontSize(10).fill('#2C2C2C').font('Helvetica-Bold')
          .text('Supplements: ', 50, y, { continued: true })
          .font('Helvetica').text(n.supplements.join(', '));
        y += 18;
      }

      if (n.hydration) {
        doc.fontSize(10).fill('#2C2C2C').font('Helvetica-Bold')
          .text('Hydration: ', 50, y, { continued: true })
          .font('Helvetica').text(n.hydration);
      }
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#999999').font('Helvetica')
        .text(
          'fitnessbymaddy.com | This program is for personal use only.',
          50, 780, { width: 495, align: 'center' }
        );
    }

    doc.end();
  });
}
