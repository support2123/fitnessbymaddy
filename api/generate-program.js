const { getSupabase } = require('./_utils/supabase');
const { sendDocument, notifyMaddy } = require('./_utils/whatsapp');
const { maskPhone } = require('./_utils/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'under 1000', 'below 1000',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for', 'dry fast'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
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
      return res.json({ success: true, message: 'Program already exists', program_id: existingProgram.id });
    }

    const claudeResponse = await callClaude(client, recentCheckins || [], week_no);

    if (claudeResponse.flagged) {
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: claudeResponse.workout_plan,
        nutrition_plan: claudeResponse.nutrition_plan,
        notes: claudeResponse.notes,
        flagged_for_review: true
      });

      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nReason: ${claudeResponse.flag_reason}`
      );

      return res.json({ success: true, flagged: true, reason: claudeResponse.flag_reason });
    }

    const pdfHtml = renderProgramPdf(client, week_no, claudeResponse);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'text/html',
        upsert: true
      });

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: claudeResponse.workout_plan,
      nutrition_plan: claudeResponse.nutrition_plan,
      notes: claudeResponse.notes,
      pdf_url: urlData.publicUrl,
      flagged_for_review: false
    }).select().single();

    const sendResult = await sendDocument(
      client.phone,
      urlData.publicUrl,
      `Week ${week_no} program ready! ${claudeResponse.notes || ''}`
    );

    if (sendResult.sent) {
      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.json({
      success: true,
      program_id: program.id,
      pdf_url: urlData.publicUrl,
      whatsapp_sent: sendResult.sent
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function callClaude(client, checkins, weekNo) {
  const prompt = buildPrompt(client, checkins, weekNo);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: prompt
      }],
      system: SYSTEM_PROMPT
    })
  });

  const result = await response.json();
  const text = result.content?.[0]?.text || '';

  let parsed;
  try {
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : '{}');
  } catch {
    parsed = { workout_plan: { raw: text }, nutrition_plan: {}, notes: 'Auto-parsed' };
  }

  const fullText = JSON.stringify(parsed).toLowerCase();
  let flagged = false;
  let flagReason = '';

  for (const flag of SAFETY_FLAGS) {
    if (fullText.includes(flag)) {
      flagged = true;
      flagReason = `Contains: "${flag}"`;
      break;
    }
  }

  return {
    workout_plan: parsed.workout_plan || parsed.workouts || {},
    nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
    notes: parsed.notes || parsed.summary || '',
    flagged,
    flag_reason: flagReason
  };
}

const SYSTEM_PROMPT = `You are a certified fitness program architect working for FitnessByMaddy.
You create personalized weekly workout and nutrition plans.

Rules:
- All recommendations must be evidence-based and safe
- Never recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances or extreme supplements
- Never promise unrealistic timelines
- Adapt based on check-in data (compliance, energy, issues)
- Progressive overload principles for strength work
- Include rest days and deload guidance

Output format: JSON with workout_plan, nutrition_plan, and notes fields.`;

function buildPrompt(client, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for client:\n`;
  prompt += `Name: ${client.name}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Started: ${client.program_started_at}\n\n`;

  if (checkins.length > 0) {
    prompt += 'Recent check-ins:\n';
    for (const c of checkins) {
      prompt += `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, `;
      prompt += `Compliance=${c.compliance_score}/10, Energy=${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  prompt += '\nReturn a JSON object with: workout_plan (7 days), nutrition_plan (macros + meals), and notes (1-line context for WhatsApp).';
  return prompt;
}

function renderProgramPdf(client, weekNo, program) {
  const workouts = program.workout_plan || {};
  const nutrition = program.nutrition_plan || {};

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'DM Sans', sans-serif; background: #000; color: #fff; padding: 40px; }
.header { border-bottom: 3px solid #B8965A; padding-bottom: 20px; margin-bottom: 30px; }
.brand { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; letter-spacing: 4px; }
.week { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; margin-top: 8px; }
.client-name { font-size: 14px; color: #888; margin-top: 4px; }
.section-title { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #B8965A;
  margin: 30px 0 15px; border-left: 3px solid #B8965A; padding-left: 12px; }
.day { background: #111; border: 1px solid #222; border-radius: 4px; padding: 16px; margin-bottom: 12px; }
.day-name { font-weight: 600; color: #B8965A; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.exercise { font-size: 13px; color: #ccc; padding: 4px 0; border-bottom: 1px solid #1a1a1a; }
.macro-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
.macro-box { background: #111; border: 1px solid #222; border-radius: 4px; padding: 16px; text-align: center; }
.macro-val { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; }
.macro-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
.notes { background: #0a0a0a; border: 1px solid #B8965A; border-radius: 4px; padding: 16px; margin-top: 24px; font-size: 13px; color: #ccc; line-height: 1.6; }
.footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #222; font-size: 11px; color: #555; }
</style>
</head>
<body>
<div class="header">
  <div class="brand">FITNESS BY MADDY</div>
  <div class="week">WEEK ${weekNo} PROGRAM</div>
  <div class="client-name">${client.name} | ${client.program.replace('_', ' ').toUpperCase()}</div>
</div>

<div class="section-title">WORKOUT PLAN</div>
${renderWorkouts(workouts)}

<div class="section-title">NUTRITION PLAN</div>
${renderNutrition(nutrition)}

${program.notes ? `<div class="notes"><strong>Coach's Note:</strong> ${program.notes}</div>` : ''}

<div class="footer">FITNESS BY MADDY | fitnessbymaddy.com | Generated ${new Date().toLocaleDateString()}</div>
</body>
</html>`;
}

function renderWorkouts(plan) {
  if (typeof plan === 'string') return `<div class="day"><div class="exercise">${escapeHtml(plan)}</div></div>`;

  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  let html = '';

  if (Array.isArray(plan)) {
    plan.forEach((day, i) => {
      html += `<div class="day"><div class="day-name">${days[i] || `Day ${i + 1}`}</div>`;
      if (typeof day === 'string') {
        html += `<div class="exercise">${escapeHtml(day)}</div>`;
      } else if (day.exercises) {
        day.exercises.forEach(ex => {
          const desc = typeof ex === 'string' ? ex : `${ex.name || ex.exercise} — ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '(Rest: ' + ex.rest + ')' : ''}`;
          html += `<div class="exercise">${escapeHtml(desc)}</div>`;
        });
      }
      html += '</div>';
    });
  } else {
    for (const [dayName, exercises] of Object.entries(plan)) {
      html += `<div class="day"><div class="day-name">${escapeHtml(dayName)}</div>`;
      if (Array.isArray(exercises)) {
        exercises.forEach(ex => {
          const desc = typeof ex === 'string' ? ex : `${ex.name || ex.exercise || ''} — ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '(Rest: ' + ex.rest + ')' : ''}`;
          html += `<div class="exercise">${escapeHtml(desc)}</div>`;
        });
      } else if (typeof exercises === 'string') {
        html += `<div class="exercise">${escapeHtml(exercises)}</div>`;
      }
      html += '</div>';
    }
  }

  return html || '<div class="day"><div class="exercise">Program details will be provided shortly.</div></div>';
}

function renderNutrition(plan) {
  if (!plan || Object.keys(plan).length === 0) {
    return '<div class="day"><div class="exercise">Nutrition plan details will be provided shortly.</div></div>';
  }

  let html = '';

  if (plan.macros || plan.calories) {
    html += '<div class="macro-grid">';
    html += `<div class="macro-box"><div class="macro-val">${plan.calories || plan.macros?.calories || '—'}</div><div class="macro-label">Calories</div></div>`;
    html += `<div class="macro-box"><div class="macro-val">${plan.protein || plan.macros?.protein || '—'}g</div><div class="macro-label">Protein</div></div>`;
    html += `<div class="macro-box"><div class="macro-val">${plan.carbs || plan.macros?.carbs || '—'}g</div><div class="macro-label">Carbs</div></div>`;
    html += `<div class="macro-box"><div class="macro-val">${plan.fats || plan.fat || plan.macros?.fats || '—'}g</div><div class="macro-label">Fats</div></div>`;
    html += '</div>';
  }

  const meals = plan.meals || plan.meal_plan || [];
  if (Array.isArray(meals)) {
    meals.forEach(meal => {
      const name = typeof meal === 'string' ? meal : meal.name || meal.meal;
      const items = typeof meal === 'string' ? '' : (meal.items || meal.foods || []).join(', ');
      html += `<div class="day"><div class="day-name">${escapeHtml(name || 'Meal')}</div>`;
      if (items) html += `<div class="exercise">${escapeHtml(items)}</div>`;
      html += '</div>';
    });
  }

  return html || '<div class="day"><div class="exercise">Follow the macro targets above with whole, minimally processed foods.</div></div>';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
