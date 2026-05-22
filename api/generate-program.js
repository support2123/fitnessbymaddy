const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'banned substance', 'steroid',
  'ephedrine', 'dnp', 'clenbuterol', 'crash diet', '500 calories',
  'lose 10kg in 1 week', 'starvation'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: previousPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    let intakeData = {};
    if (lead?.first_msg) {
      try { intakeData = JSON.parse(lead.first_msg); } catch (e) { /* not JSON */ }
    }

    const anthropic = new Anthropic();
    const prompt = buildProgramPrompt(client, intakeData, recentCheckins, previousPrograms, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    const hasSafetyIssue = SAFETY_FLAGS.some(flag => content.toLowerCase().includes(flag));
    if (hasSafetyIssue) {
      await escalateToMaddy(
        'Safety flag in generated program',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nContent flagged for review before sending.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch (e) {
      parsed = { workout_plan: content, nutrition_plan: '' };
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });
    const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: urlData.publicUrl,
      workout_plan: parsed.workout_plan || parsed,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.notes || null
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(week_no)],
      media: { url: urlData.publicUrl, filename: `Week_${week_no}_Program.pdf` }
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ ok: true, programId: program.id, pdfUrl: urlData.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, intake, checkins, previousPrograms, weekNo) {
  const checkinSummary = checkins?.length
    ? checkins.map(c =>
        `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`
      ).join('\n')
    : 'No previous check-ins.';

  const prevPlan = previousPrograms?.[0]
    ? `Previous week plan summary available.`
    : 'First week — no previous plan.';

  return `You are an expert fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program} (Week ${weekNo} of ${client.program === '12wk' ? 12 : 6})
- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Injuries/limitations: ${intake.injuries || 'None reported'}
- Diet preference: ${intake.diet_preference || 'No preference'}
- Schedule: ${intake.schedule || 'Flexible'}
- Experience: ${intake.experience_level || 'Intermediate'}

RECENT CHECK-INS:
${checkinSummary}

PREVIOUS PROGRAM:
${prevPlan}

INSTRUCTIONS:
1. Create a complete 7-day workout plan with exercises, sets, reps, and rest periods.
2. Create a nutrition plan with daily macros and meal suggestions.
3. Add 1-2 coaching notes based on check-in data.
4. Be realistic — never suggest extreme calorie restriction or unrealistic timelines.
5. Adjust intensity based on compliance score and energy levels from check-ins.

Return as JSON with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "cardio": "20 min moderate incline walk"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein": "180g",
    "carbs": "220g",
    "fats": "70g",
    "meals": [
      {"meal": "Breakfast", "suggestion": "4 egg whites + 1 whole egg + oats with berries"}
    ],
    "hydration": "3-4 liters water daily"
  },
  "notes": "Focus note based on last check-in"
}
\`\`\``;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fillColor('#B8965A')
      .fontSize(32)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 50, { align: 'center' });

    doc.moveDown(0.5);
    doc.fillColor('#D4AF7A')
      .fontSize(14)
      .font('Helvetica')
      .text('PERSONALIZED PROGRAM', { align: 'center' });

    doc.moveDown(2);
    doc.fillColor('#FFFFFF')
      .fontSize(24)
      .font('Helvetica-Bold')
      .text(`WEEK ${weekNo}`, { align: 'center' });

    doc.moveDown(0.3);
    doc.fillColor('#B8965A')
      .fontSize(12)
      .font('Helvetica')
      .text(`${client.name || 'Client'} — ${formatProgram(client.program)}`, { align: 'center' });

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#B8965A').lineWidth(0.5).stroke();
    doc.moveDown(1);

    const workout = programData.workout_plan;
    if (workout?.days) {
      doc.fillColor('#B8965A').fontSize(18).font('Helvetica-Bold').text('WORKOUT PLAN');
      doc.moveDown(1);

      for (const day of workout.days) {
        if (doc.y > doc.page.height - 150) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
        }

        doc.fillColor('#D4AF7A').fontSize(14).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus || ''}`);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica')
              .text(`  • ${ex.name}: ${ex.sets} × ${ex.reps} (Rest: ${ex.rest || '60s'})${ex.notes ? ' — ' + ex.notes : ''}`);
          }
        }
        if (day.cardio) {
          doc.fillColor('#888888').fontSize(10).font('Helvetica')
            .text(`  Cardio: ${day.cardio}`);
        }
        doc.moveDown(0.8);
      }
    }

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      if (doc.y > doc.page.height - 200) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
      }

      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#B8965A').lineWidth(0.5).stroke();
      doc.moveDown(1);

      doc.fillColor('#B8965A').fontSize(18).font('Helvetica-Bold').text('NUTRITION PLAN');
      doc.moveDown(0.5);

      if (nutrition.calories) {
        doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica')
          .text(`Daily Target: ${nutrition.calories} kcal | Protein: ${nutrition.protein || '-'} | Carbs: ${nutrition.carbs || '-'} | Fats: ${nutrition.fats || '-'}`);
        doc.moveDown(0.5);
      }

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fillColor('#D4AF7A').fontSize(10).font('Helvetica-Bold')
            .text(`${meal.meal}:`);
          doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica')
            .text(`  ${meal.suggestion}`);
          doc.moveDown(0.3);
        }
      }

      if (nutrition.hydration) {
        doc.moveDown(0.3);
        doc.fillColor('#888888').fontSize(10).text(`Hydration: ${nutrition.hydration}`);
      }
    }

    if (programData.notes) {
      doc.moveDown(1.5);
      doc.fillColor('#B8965A').fontSize(14).font('Helvetica-Bold').text('COACH NOTES');
      doc.moveDown(0.3);
      doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica').text(programData.notes);
    }

    const bottomY = doc.page.height - 40;
    doc.fillColor('#555555').fontSize(8).font('Helvetica')
      .text('© Fitness by Maddy — For personal use only. Do not redistribute.', 50, bottomY, { align: 'center' });

    doc.end();
  });
}

function formatProgram(program) {
  const labels = {
    '6wk_gym': '6-Week Gym Program',
    '6wk_home': '6-Week Home Program',
    '12wk': '12-Week Custom Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return labels[program] || program;
}
