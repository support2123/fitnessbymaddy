const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/mask-phone');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*cal/i, /extreme\s*fast/i, /starvation/i,
  /dnp/i, /clenbuterol/i, /steroid/i, /sarm/i, /ephedra/i,
  /lose\s*\d{2,}\s*kg\s*in\s*\d\s*week/i, /crash\s*diet/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    let intakeData = {};
    if (lead?.first_msg) {
      try { intakeData = JSON.parse(lead.first_msg); } catch (e) { /* not JSON */ }
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, intakeData, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const programText = response.content[0].text;

    if (containsUnsafeContent(programText)) {
      await notifyMaddy(
        'Program flagged for review',
        `${client.name || maskPhone(client.phone)} week ${week_no}: auto-generated program contains potentially unsafe content. Manual review required.`
      );
      await db.from('programs').upsert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        notes: 'FLAGGED: contains potentially unsafe content, awaiting manual review',
        workout_plan: {},
        nutrition_plan: {}
      }, { onConflict: 'client_id,week_no' });
      return res.status(200).json({ ok: true, flagged: true });
    }

    let parsed;
    try {
      const jsonMatch = programText.match(/```json\n?([\s\S]*?)```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : programText);
    } catch (e) {
      parsed = { raw: programText, workout_plan: {}, nutrition_plan: {} };
    }

    const workoutPlan = parsed.workout_plan || parsed.workout || {};
    const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    const notes = parsed.notes || parsed.coach_notes || '';

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan, notes);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError);
    }

    const { data: urlData } = await db.storage
      .from('client-files')
      .createSignedUrl(filePath, 7 * 86400);

    const pdfUrl = urlData?.signedUrl || filePath;

    await db.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }, { onConflict: 'client_id,week_no' });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      notes ? notes.substring(0, 200) : 'Your new week is ready!'
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = checkins?.length
    ? checkins.map(c =>
        `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
      ).join('\n')
    : 'No previous check-in data.';

  return `You are a certified fitness coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
${intake.age ? `- Age: ${intake.age}` : ''}
${intake.gender ? `- Gender: ${intake.gender}` : ''}
${intake.goal ? `- Goal: ${intake.goal}` : ''}
${intake.injuries ? `- Injuries/limitations: ${intake.injuries}` : ''}
${intake.diet_preference ? `- Diet preference: ${intake.diet_preference}` : ''}
${intake.equipment_access ? `- Equipment: ${intake.equipment_access}` : ''}
${intake.schedule ? `- Schedule: ${intake.schedule}` : ''}

RECENT CHECK-INS:
${checkinSummary}

RULES:
- Create a safe, evidence-based program
- Never recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never suggest banned substances or supplements without evidence
- Be realistic about timelines (max 0.5-1kg fat loss per week)
- Adjust intensity based on compliance and energy scores
- If issues mention pain, reduce intensity for affected area

Return a JSON object with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": "3x 20min moderate intensity",
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meal_framework": [
      { "meal": "Breakfast", "example": "Oats with whey, banana, almonds", "macros": "P:30 C:50 F:15" }
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D3"]
  },
  "notes": "One sentence coach note for this week",
  "coach_notes": "Brief context on changes from last week"
}
\`\`\``;
}

function containsUnsafeContent(text) {
  return UNSAFE_PATTERNS.some(pattern => pattern.test(text));
}

async function generatePDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 100).fill('#1a1a1a');
    doc.fontSize(28).fill('#D4AF7A').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(12).fill('#ffffff').font('Helvetica')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 65);

    doc.moveDown(3);

    // Notes section
    if (notes) {
      doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
        .text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
        .text(notes, 50, undefined, { width: 495 });
      doc.moveDown(1);
    }

    // Workout plan
    doc.fill('#B8965A').fontSize(16).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (workout.days) {
      for (const day of workout.days) {
        doc.fill('#1a1a1a').fontSize(12).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus || ''}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}${ex.notes ? '  |  ' + ex.notes : ''}`, 60);
          }
        }
        doc.moveDown(0.5);

        if (doc.y > 700) doc.addPage();
      }
    }

    if (workout.cardio) {
      doc.moveDown(0.5);
      doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold').text('Cardio:', 50);
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica').text(workout.cardio, 110, undefined);
    }

    // Nutrition plan
    doc.addPage();
    doc.rect(0, 0, 595, 60).fill('#1a1a1a');
    doc.fontSize(16).fill('#D4AF7A').font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 20);

    doc.moveDown(3);

    if (nutrition.calories) {
      doc.fill('#1a1a1a').fontSize(11).font('Helvetica-Bold')
        .text(`Daily Targets:  ${nutrition.calories} cal  |  P: ${nutrition.protein_g || '—'}g  |  C: ${nutrition.carbs_g || '—'}g  |  F: ${nutrition.fat_g || '—'}g`, 50);
      doc.moveDown(1);
    }

    if (nutrition.meal_framework) {
      for (const meal of nutrition.meal_framework) {
        doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold')
          .text(meal.meal, 50);
        doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
          .text(`  ${meal.example}${meal.macros ? '  (' + meal.macros + ')' : ''}`, 60);
        doc.moveDown(0.5);
      }
    }

    if (nutrition.hydration) {
      doc.moveDown(0.5);
      doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold').text('Hydration:', 50);
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica').text(nutrition.hydration, 130);
    }

    if (nutrition.supplements?.length) {
      doc.moveDown(0.5);
      doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold').text('Supplements:', 50);
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
        .text(nutrition.supplements.join(', '), 140);
    }

    // Footer
    doc.moveDown(3);
    doc.fill('#999').fontSize(8).font('Helvetica')
      .text('Generated by Fitness by Maddy | fitnessbymaddy.com | For personal use only', 50, undefined, { align: 'center' });

    doc.end();
  });
}
