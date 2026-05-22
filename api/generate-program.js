import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import { getSupabase } from './_lib/supabase.js';
import { sendWhatsApp } from './_lib/whatsapp.js';
import { handleCors, parseBody, PROGRAM_NAMES } from './_lib/utils.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const { client_id, week_no } = parseBody(req);

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

  const { data: leadData } = await db
    .from('leads')
    .select('first_msg')
    .eq('id', client.lead_id)
    .single();

  let intakeProfile = {};
  try { intakeProfile = JSON.parse(leadData?.first_msg || '{}'); } catch {}

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const prompt = buildPrompt(client, intakeProfile, recentCheckins, week_no);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const content = response.content[0]?.text || '';

  let workoutPlan, nutritionPlan, notes;
  try {
    const parsed = JSON.parse(content);
    workoutPlan = parsed.workout_plan;
    nutritionPlan = parsed.nutrition_plan;
    notes = parsed.coach_notes;
  } catch {
    workoutPlan = { raw: content };
    nutritionPlan = {};
    notes = 'Auto-parsed failed — review raw output';
  }

  if (containsRiskyContent(content)) {
    await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: 'FLAGGED: Contains potentially risky content. Awaiting Maddy review.'
    });
    return res.json({ ok: false, reason: 'flagged_for_review' });
  }

  const pdfBuffer = await generatePDF(client, workoutPlan, nutritionPlan, notes, week_no);

  const filePath = `clients/${client_id}/week_${week_no}.pdf`;
  await db.storage
    .from('client-files')
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  const { data: urlData } = db.storage
    .from('client-files')
    .getPublicUrl(filePath);

  const pdfUrl = urlData?.publicUrl || '';

  const { error } = await db.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: workoutPlan,
    nutrition_plan: nutritionPlan,
    notes
  });

  if (error) return res.status(500).json({ error: 'Failed to save program' });

  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    `Week ${week_no}`,
    pdfUrl
  ]);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString()
  }).eq('client_id', client_id).eq('week_no', week_no);

  return res.json({ ok: true, pdf_url: pdfUrl });
}

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Injuries/Conditions: ${intake.injuries || 'none reported'}
- Diet Preference: ${intake.diet_preference || 'no restriction'}
- Experience: ${intake.experience_level || 'intermediate'}
- Equipment: ${intake.equipment_access || 'full gym'}
- Schedule: ${intake.workout_schedule || '5 days/week'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

OUTPUT FORMAT: Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "description",
    "weekly_volume_notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fat_g": 70,
    "meal_timing": "description",
    "hydration": "3-4L water daily",
    "supplements": ["optional"],
    "sample_meals": [
      { "meal": "Breakfast", "options": ["option1", "option2"] }
    ]
  },
  "coach_notes": "Brief motivational note + key focus for this week"
}

RULES:
- Never recommend extreme calorie deficits (below 1200 for women, 1500 for men)
- Never recommend banned/dangerous supplements
- Adjust based on check-in data (reduce volume if low energy/compliance, progress if strong)
- Be specific with exercises, sets, reps
- Keep it safe and evidence-based`;
}

function containsRiskyContent(content) {
  const lower = content.toLowerCase();
  const riskyPatterns = [
    /calori.*[0-9]{3,4}/,
    /dnp|clenbuterol|ephedra|sarm|steroid|hgh|testosterone/,
    /lose.*[2-9]0.*pound.*week/,
    /starvation|water\s*fast.*extended/
  ];

  for (const pattern of riskyPatterns) {
    if (pattern.test(lower)) {
      const match = lower.match(pattern);
      if (match && match[0].includes('calori')) {
        const cals = lower.match(/(\d{3,4})\s*cal/);
        if (cals && parseInt(cals[1]) < 1200) return true;
      }
      if (!match[0].includes('calori')) return true;
    }
  }
  return false;
}

function generatePDF(client, workout, nutrition, notes, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`${client.name || 'Client'} — Week ${weekNo}`, 50, 75);
    doc.fontSize(10).fill('#D4AF7A')
      .text(PROGRAM_NAMES[client.program] || client.program, 50, 95);

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    if (notes) {
      doc.fontSize(10).fill('#6B6B6B').text(notes, 50, doc.y, { width: 500 });
      doc.moveDown(1.5);
    }

    doc.fontSize(16).fill('#B8965A').text('WORKOUT PLAN', 50, doc.y);
    doc.moveDown(0.5);

    const days = workout?.days || [];
    for (const day of days) {
      doc.fontSize(12).fill('#2C2C2C').text(`${day.day} — ${day.focus || ''}`, 50, doc.y);
      doc.moveDown(0.3);

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        doc.fontSize(9).fill('#6B6B6B')
          .text(`  → ${ex.name}: ${ex.sets}×${ex.reps} (Rest: ${ex.rest || '60s'})`, 60, doc.y);
        doc.moveDown(0.2);
      }
      doc.moveDown(0.5);

      if (doc.y > 700) {
        doc.addPage();
        doc.fill('#2C2C2C');
      }
    }

    if (workout?.cardio) {
      doc.moveDown(0.5);
      doc.fontSize(10).fill('#2C2C2C').text(`Cardio: ${workout.cardio}`, 50, doc.y);
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fontSize(16).fill('#B8965A').text('NUTRITION PLAN', 50, 20);

    doc.moveDown(2);
    doc.fill('#2C2C2C');

    if (nutrition?.calories) {
      doc.fontSize(11).text(`Daily Target: ${nutrition.calories} kcal`, 50, doc.y);
      doc.fontSize(9).fill('#6B6B6B')
        .text(`Protein: ${nutrition.protein_g || '—'}g | Carbs: ${nutrition.carbs_g || '—'}g | Fat: ${nutrition.fat_g || '—'}g`, 50, doc.y + 16);
      doc.moveDown(1.5);
    }

    const meals = nutrition?.sample_meals || [];
    for (const meal of meals) {
      doc.fontSize(10).fill('#2C2C2C').text(meal.meal, 50, doc.y);
      const opts = meal.options || [];
      for (const opt of opts) {
        doc.fontSize(9).fill('#6B6B6B').text(`  • ${opt}`, 60, doc.y + 14);
        doc.moveDown(0.3);
      }
      doc.moveDown(0.5);
    }

    if (nutrition?.hydration) {
      doc.moveDown(0.5);
      doc.fontSize(9).fill('#6B6B6B').text(`Hydration: ${nutrition.hydration}`, 50, doc.y);
    }

    doc.end();
  });
}
