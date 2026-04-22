import Anthropic from '@anthropic-ai/sdk';
import supabase from './lib/supabase.js';
import { sendMedia } from './lib/whatsapp.js';
import { logMessage } from './lib/rate-limit.js';
import { escalate } from './lib/escalation.js';

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'sarms', 'steroids', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

function auditProgramSafety(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

const SYSTEM_PROMPT = `You are Maddy's AI program architect. You design weekly fitness programs for coaching clients.

RULES:
- Programs must be safe, evidence-based, and progressive
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, steroids, or unproven supplements
- Never promise specific weight loss timelines
- Consider injuries, medical conditions, and fitness level
- Include warm-up and cool-down in every workout
- Nutrition should be sustainable, not crash-dieting

OUTPUT FORMAT: Return valid JSON with two keys:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "..." }] }
    ],
    "warmup": "...",
    "cooldown": "..."
  },
  "nutrition_plan": {
    "daily_calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "notes": "..." }
    ],
    "supplements": ["..."],
    "hydration": "..."
  }
}`;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await supabase
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
      weight: recentCheckins?.[0]?.weight || intake?.weight_kg,
      goal: intake?.goal,
      injuries: intake?.injuries,
      diet: intake?.diet_preference,
      experience: intake?.training_experience,
      schedule: intake?.schedule,
      medical: intake?.medical_conditions,
      recent_checkins: recentCheckins?.map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues,
      })),
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n\n${JSON.stringify(clientProfile, null, 2)}`,
      }],
    });

    const responseText = response.content[0].text;

    const safetyIssue = auditProgramSafety(responseText);
    if (safetyIssue) {
      await escalate(client.phone, `unsafe_program_content: ${safetyIssue}`, `Week ${week_no} program flagged for review`);
      return res.status(200).json({ status: 'flagged_for_review', flag: safetyIssue });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const pdfHtml = generateProgramPDF(client.name, week_no, parsed);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = supabase.storage.from('client-files').getPublicUrl(pdfPath);
    const publicUrl = urlData?.publicUrl || '';

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: `Generated automatically for week ${week_no}`,
    }).select().single();

    const market = client.leads?.market || 'GLOBAL';
    const caption = market === 'IN'
      ? `Week ${week_no} ka program ready hai! 💪 Check karo aur koi doubt ho toh poochho.`
      : `Your Week ${week_no} program is ready! 💪 Check it out and feel free to ask any questions.`;

    await sendMedia(client.phone, publicUrl, caption);
    await logMessage(client.phone, 'out', caption, 'weekly_program');

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ status: 'generated', program_id: program.id });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function generateProgramPDF(clientName, weekNo, plan) {
  const workout = plan.workout_plan || {};
  const nutrition = plan.nutrition_plan || {};

  const daysHtml = (workout.days || []).map(day => `
    <div class="day-block">
      <h3>${day.day} — ${day.focus}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>
        ${(day.exercises || []).map(ex => `
          <tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest}</td><td>${ex.notes || ''}</td></tr>
        `).join('')}
      </table>
    </div>
  `).join('');

  const mealsHtml = (nutrition.meals || []).map(m => `
    <div class="meal-block">
      <h4>${m.meal}</h4>
      <ul>${(m.options || []).map(o => `<li>${o}</li>`).join('')}</ul>
      ${m.notes ? `<p class="meal-note">${m.notes}</p>` : ''}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${clientName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 40px 24px; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 3px; margin: 40px 0 20px; border-left: 4px solid #B8965A; padding-left: 16px; }
  .day-block { background: #141414; border: 1px solid #222; border-radius: 8px; padding: 24px; margin-bottom: 20px; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #fff; letter-spacing: 2px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1a1a1a; color: #B8965A; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; padding: 10px 12px; text-align: left; }
  td { padding: 10px 12px; border-bottom: 1px solid #1a1a1a; font-size: 14px; color: #ccc; }
  .warmup { background: #0d1a0d; border: 1px solid #1a3a1a; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; color: #7cb87c; }
  .macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .macro-box { background: #141414; border: 1px solid #222; border-radius: 8px; padding: 20px; text-align: center; }
  .macro-box .num { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-box .label { font-size: 11px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-top: 4px; }
  .meal-block { background: #141414; border: 1px solid #222; border-radius: 8px; padding: 20px; margin-bottom: 12px; }
  .meal-block h4 { color: #B8965A; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
  .meal-block ul { list-style: none; }
  .meal-block li { padding: 4px 0; font-size: 14px; color: #ccc; }
  .meal-block li::before { content: '→ '; color: #B8965A; }
  .meal-note { font-size: 12px; color: #888; margin-top: 8px; font-style: italic; }
  .footer { text-align: center; margin-top: 60px; padding-top: 24px; border-top: 1px solid #222; color: #555; font-size: 12px; }
  @media (max-width: 600px) { .macros { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <h2>WEEK ${weekNo} PROGRAM</h2>
  <p>${clientName} — Custom Training & Nutrition Plan</p>
</div>

<h2 class="section-title">WORKOUT PLAN</h2>
${workout.warmup ? `<div class="warmup"><strong>Warm-up:</strong> ${workout.warmup}</div>` : ''}
${daysHtml}
${workout.cooldown ? `<div class="warmup"><strong>Cool-down:</strong> ${workout.cooldown}</div>` : ''}

<h2 class="section-title">NUTRITION PLAN</h2>
<div class="macros">
  <div class="macro-box"><div class="num">${nutrition.daily_calories || '—'}</div><div class="label">Calories</div></div>
  <div class="macro-box"><div class="num">${nutrition.protein_g || '—'}g</div><div class="label">Protein</div></div>
  <div class="macro-box"><div class="num">${nutrition.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
  <div class="macro-box"><div class="num">${nutrition.fats_g || '—'}g</div><div class="label">Fats</div></div>
</div>
${mealsHtml}

${nutrition.hydration ? `<div class="warmup" style="background:#0d0d1a; border-color:#1a1a3a; color:#7c7cb8;"><strong>Hydration:</strong> ${nutrition.hydration}</div>` : ''}

<div class="footer">
  <p>FITNESS BY MADDY &mdash; Custom Coaching</p>
  <p style="margin-top:4px;">This program is personalised for you. Do not share.</p>
</div>
</body>
</html>`;
}
