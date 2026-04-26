const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');
const { notifyMaddy } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'sarms',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme deficit', 'very low calorie'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(f => lower.includes(f));
}

async function generatePDF(workout, nutrition, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 100).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30, { align: 'left' });
    doc.fill('#FFFFFF').fontSize(12).font('Helvetica')
      .text(`${clientName || 'Client'} — Week ${weekNo}`, 50, 65, { align: 'left' });

    doc.fill('#2C2C2C');
    let y = 130;

    doc.fontSize(20).font('Helvetica-Bold').fill('#B8965A')
      .text('WORKOUT PLAN', 50, y);
    y += 35;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(14).font('Helvetica-Bold').fill('#2C2C2C')
          .text(day.name || day.day, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            doc.fontSize(10).font('Helvetica').fill('#6B6B6B')
              .text(`• ${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''}  ${ex.rest || ''}`, 70, y);
            y += 16;
          }
        }
        y += 10;
      }
    } else {
      doc.fontSize(11).font('Helvetica').fill('#6B6B6B')
        .text(JSON.stringify(workout, null, 2).slice(0, 2000), 50, y, { width: 500 });
      y += 200;
    }

    if (y > 600) { doc.addPage(); y = 50; }

    doc.fontSize(20).font('Helvetica-Bold').fill('#B8965A')
      .text('NUTRITION PLAN', 50, y);
    y += 35;

    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).font('Helvetica-Bold').fill('#2C2C2C')
          .text(meal.name || meal.meal, 50, y);
        y += 18;
        doc.fontSize(10).font('Helvetica').fill('#6B6B6B')
          .text(meal.description || meal.foods || '', 70, y, { width: 460 });
        y += 30;
      }

      if (nutrition.daily_totals) {
        y += 10;
        doc.fontSize(11).font('Helvetica-Bold').fill('#2C2C2C')
          .text(`Daily Totals: ${nutrition.daily_totals.calories || ''}kcal | P: ${nutrition.daily_totals.protein || ''}g | C: ${nutrition.daily_totals.carbs || ''}g | F: ${nutrition.daily_totals.fat || ''}g`, 50, y);
      }
    } else {
      doc.fontSize(11).font('Helvetica').fill('#6B6B6B')
        .text(JSON.stringify(nutrition, null, 2).slice(0, 2000), 50, y, { width: 500 });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const sb = getSupabase();

    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await sb
      .from('intake_forms')
      .select('*')
      .eq('phone', client.phone)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      age: intake?.age,
      gender: intake?.gender,
      height: intake?.height_cm,
      current_weight: recentCheckins?.[0]?.weight || intake?.current_weight,
      target_weight: intake?.target_weight,
      goal: intake?.goal,
      injuries: intake?.injuries,
      diet_preference: intake?.diet_preference,
      equipment: intake?.available_equipment,
      days_per_week: intake?.days_per_week,
      recent_checkins: recentCheckins?.map(c => ({
        week: c.week_no,
        weight: c.weight,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues
      }))
    };

    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are a certified fitness program architect for FitnessByMaddy. Generate a weekly program for this client.

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

Generate Week ${week_no} program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "name": "Day 1 - Upper Body", "exercises": [
        { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
      ]}
    ],
    "notes": "string"
  },
  "nutrition_plan": {
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "description with portions" }
    ],
    "daily_totals": { "calories": 2000, "protein": 150, "carbs": 200, "fat": 70 },
    "notes": "string"
  },
  "coach_note": "One-liner context for WhatsApp"
}

RULES:
- Safe, evidence-based recommendations only
- No extreme calorie deficits (minimum 1200kcal for women, 1500kcal for men)
- No banned substances or supplements
- Account for injuries and medical conditions
- Progressive overload from previous weeks if data available
- Realistic timelines`
      }]
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await notifyMaddy('program_gen_failed', { client_name: client.name, week: week_no });
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const program = JSON.parse(jsonMatch[0]);

    if (hasSafetyIssue(JSON.stringify(program))) {
      await notifyMaddy('safety_flag_program', {
        client_name: client.name,
        week: week_no,
        reason: 'Program contains flagged content — halted for review'
      });
      return res.status(200).json({ flagged: true, reason: 'Safety review required' });
    }

    const pdfBuffer = await generatePDF(
      program.workout_plan, program.nutrition_plan, client.name, week_no
    );

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await sb.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: publicUrl } = sb.storage.from('programs').getPublicUrl(pdfPath);

    const { data: programRecord } = await sb.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl.publicUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.coach_note || null
    }).select().single();

    const coachNote = program.coach_note || `Week ${week_no} program is ready!`;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      coachNote
    ]);

    await sb.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', programRecord.id);

    return res.status(200).json({
      success: true,
      program_id: programRecord.id,
      pdf_url: publicUrl.publicUrl
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
