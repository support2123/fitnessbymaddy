const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendClientMessage, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /anabolic\s*steroid/i,
  /sarm/i,
  /ephedra/i,
  /lose\s*\d{2,}\s*kg\s*in\s*[12]\s*week/i
];

function isSafe(plan) {
  const text = JSON.stringify(plan);
  return !UNSAFE_PATTERNS.some(p => p.test(text));
}

async function generatePDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill('#2C2C2C');
    doc.fontSize(24).fill('#B8965A').text('FITNESS BY MADDY', 50, 25, { width: 495 });
    doc.fontSize(11).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM | ${(client.name || 'CLIENT').toUpperCase()}`, 50, 52, { width: 495 });

    doc.moveDown(3);

    // Workout section
    doc.fontSize(16).fill('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 495, 2).fill('#B8965A');
    doc.moveDown(0.8);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(12).fill('#2C2C2C').text(day.name || day.day, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  ${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''}  ${ex.rest || ''}`, 60);
          }
        }
        doc.moveDown(0.6);
      }
    } else {
      doc.fontSize(10).fill('#6B6B6B').text(JSON.stringify(workout, null, 2), 60);
    }

    doc.addPage();

    // Nutrition section
    doc.rect(0, 0, 595.28, 60).fill('#2C2C2C');
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, 20, { width: 495 });

    doc.moveDown(3);

    if (nutrition && nutrition.meals) {
      doc.fontSize(11).fill('#2C2C2C').text(`Daily Calories: ${nutrition.calories || 'As prescribed'}  |  Protein: ${nutrition.protein || '-'}g  |  Carbs: ${nutrition.carbs || '-'}g  |  Fat: ${nutrition.fat || '-'}g`, 50);
      doc.moveDown(1);

      for (const meal of nutrition.meals) {
        doc.fontSize(12).fill('#2C2C2C').text(meal.name || meal.time, 50);
        doc.moveDown(0.3);
        if (meal.items) {
          for (const item of meal.items) {
            doc.fontSize(10).fill('#6B6B6B').text(`  • ${item}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).fill('#6B6B6B').text(JSON.stringify(nutrition, null, 2), 60);
    }

    // Notes
    if (notes) {
      doc.moveDown(1);
      doc.fontSize(12).fill('#2C2C2C').text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.rect(50, doc.y, 495, 2).fill('#B8965A');
      doc.moveDown(0.5);
      doc.fontSize(10).fill('#6B6B6B').text(notes, 50, undefined, { width: 495 });
    }

    // Footer
    doc.fontSize(8).fill('#C8B89A').text('fitnessbymaddy.com | This program is confidential and personalised.', 50, 780, { width: 495, align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Load client
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Load last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Load intake data from messages
    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form_submission')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = {};
    if (intakeMsg?.body) {
      try { intakeData = JSON.parse(intakeMsg.body); } catch {}
    }

    // Build prompt for Claude
    const prompt = `You are a certified personal trainer and nutritionist creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${week_no} of 12
- Goal: ${intakeData.goal || 'general fitness'}
- Experience: ${intakeData.experience_level || 'intermediate'}
- Injuries: ${intakeData.injuries || 'none reported'}
- Diet preference: ${intakeData.diet_pref || 'no restriction'}
- Schedule: ${intakeData.schedule || '5 days/week'}

RECENT CHECK-INS:
${checkins && checkins.length > 0 ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n') : 'No check-ins yet (Week 1)'}

INSTRUCTIONS:
- Create a progressive, periodised program for this specific week
- Account for any reported issues or injuries
- Be specific with exercises, sets, reps, rest periods
- Nutrition should be realistic and sustainable
- Never prescribe extreme calorie deficits (minimum 1400 cal for women, 1600 for men)
- Never recommend banned substances or supplements with safety concerns
- Include a coach note with 2-3 sentences of encouragement and focus area

Return ONLY valid JSON in this exact format:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 — Upper Body Push",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2200,
    "protein": 160,
    "carbs": 250,
    "fat": 70,
    "meals": [
      {
        "name": "Meal 1 — Breakfast",
        "items": ["4 egg whites + 1 whole egg scrambled", "1 cup oats with banana"]
      }
    ]
  },
  "notes": "Great progress this week! Focus on..."
}`;

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawText = response.content[0].text;

    // Extract JSON from response
    let plan;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      plan = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No valid JSON in Claude response');
    }

    // Safety check
    if (!isSafe(plan)) {
      await notifyMaddy(
        'Program Safety Flag',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nFlagged content detected — review before sending.`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: plan.workout,
        nutrition_plan: plan.nutrition,
        notes: '[FLAGGED FOR REVIEW] ' + (plan.notes || '')
      });

      return res.status(200).json({ ok: true, status: 'flagged_for_review' });
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(client, week_no, plan.workout, plan.nutrition, plan.notes);

    // Upload to Supabase Storage
    const filePath = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) console.error('Upload error:', uploadError.message);

    const { data: urlData } = db.storage.from('clients').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    // Save to programs table
    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: plan.workout,
      nutrition_plan: plan.nutrition,
      notes: plan.notes || ''
    }).select().single();

    // Send via WhatsApp
    await sendClientMessage(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(week_no),
        plan.notes ? plan.notes.slice(0, 100) : 'Your new week is here!'
      ]
    });

    // Update program with send timestamp
    if (program) {
      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    return res.status(200).json({ ok: true, program_id: program?.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
