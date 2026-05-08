import { getSupabase } from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import { escalateToMaddy } from '../lib/escalation.js';

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'detox tea', 'waist trainer for fat loss'
];

function checkSafety(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const systemPrompt = `You are a certified personal trainer and nutrition coach working for Fitness by Maddy.
You create science-backed, safe, and effective weekly workout and nutrition plans.

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, steroids, or unproven supplements
- Never promise unrealistic timelines (max 1kg/week fat loss is realistic)
- Include proper warm-up and cool-down in every workout
- Account for injuries and medical conditions
- Plans must be progressive (increase difficulty gradually)
- Output ONLY valid JSON, no markdown`;

    const userPrompt = buildUserPrompt(client, intake, checkins, week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', errText);
      return res.status(500).json({ error: 'Program generation failed' });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content[0].text;

    if (checkSafety(responseText)) {
      await escalateToMaddy({
        reason: 'Program generation flagged for safety review',
        phone: client.phone,
        message: `Week ${week_no} program contained safety flags. Auto-send halted.`,
        clientName: client.name
      });
      return res.status(200).json({ ok: true, action: 'flagged_for_review' });
    }

    let plans;
    try {
      plans = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        plans = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse program JSON');
      }
    }

    const pdfHtml = generatePdfHtml(client, plans, week_no);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: plans.workout || plans.workout_plan || {},
      nutrition_plan: plans.nutrition || plans.nutrition_plan || {},
      notes: plans.notes || ''
    });

    const market = detectMarket(client.phone);
    const contextNote = isHinglish(market)
      ? `Week ${week_no} ka plan ready hai! 💪 Check karo aur questions ho toh poocho.`
      : `Your Week ${week_no} plan is ready! 💪 Check it out and let us know if you have questions.`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: `${contextNote}\n\n${pdfUrl}`,
      isClient: true
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdfUrl, weekNo: week_no });
  } catch (err) {
    console.error('Program generation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Generate a Week ${weekNo} program for this client.\n\n`;
  prompt += `CLIENT PROFILE:\n`;
  prompt += `Name: ${client.name}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'Unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'Unknown'}\n`;
    prompt += `Goal: ${intake.goal || 'General fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'None reported'}\n`;
    prompt += `Diet preference: ${intake.diet_preference || 'No restrictions'}\n`;
    prompt += `Schedule: ${intake.schedule || 'Flexible'}\n`;
    prompt += `Experience: ${intake.experience_level || 'Intermediate'}\n`;
    prompt += `Current weight: ${intake.current_weight || 'Not provided'}kg\n`;
    prompt += `Target weight: ${intake.target_weight || 'Not provided'}kg\n`;
    prompt += `Height: ${intake.height || 'Not provided'}\n`;
    if (intake.medical_conditions) {
      prompt += `Medical conditions: ${intake.medical_conditions}\n`;
    }
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRECENT CHECK-INS:\n`;
    for (const c of checkins) {
      prompt += `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, `;
      prompt += `Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10\n`;
      if (c.issues) prompt += `  Issues: ${c.issues}\n`;
    }
  }

  prompt += `\nOUTPUT FORMAT (JSON only):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ], "warmup": "...", "cooldown": "..." }
    ],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Key focus for this week..."
}`;

  return prompt;
}

function generatePdfHtml(client, plans, weekNo) {
  const workout = plans.workout || plans.workout_plan || {};
  const nutrition = plans.nutrition || plans.nutrition_plan || {};
  const days = workout.days || [];

  let workoutHtml = '';
  for (const day of days) {
    workoutHtml += `<div class="day-block">
      <h3>${day.day} — ${day.focus || ''}</h3>
      ${day.warmup ? `<p class="warmup">Warm-up: ${day.warmup}</p>` : ''}
      <table><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>`;
    for (const ex of (day.exercises || [])) {
      workoutHtml += `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || '-'}</td></tr>`;
    }
    workoutHtml += `</table>
      ${day.cooldown ? `<p class="cooldown">Cool-down: ${day.cooldown}</p>` : ''}
    </div>`;
  }

  const meals = nutrition.meals || [];
  let nutritionHtml = `<div class="macro-summary">
    <div class="macro">Calories: <strong>${nutrition.calories || '—'}</strong></div>
    <div class="macro">Protein: <strong>${nutrition.protein_g || '—'}g</strong></div>
    <div class="macro">Carbs: <strong>${nutrition.carbs_g || '—'}g</strong></div>
    <div class="macro">Fat: <strong>${nutrition.fat_g || '—'}g</strong></div>
  </div>`;
  for (const meal of meals) {
    nutritionHtml += `<div class="meal-block"><h4>${meal.meal}</h4><ul>`;
    for (const opt of (meal.options || [])) {
      nutritionHtml += `<li>${opt}</li>`;
    }
    nutritionHtml += `</ul></div>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program - ${client.name}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #FAF8F4; padding: 40px 24px; }
.header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 32px; }
.header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
.header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #FAF8F4; letter-spacing: 2px; margin-top: 8px; }
.header p { color: #888; font-size: 14px; margin-top: 8px; }
.section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 3px; margin: 32px 0 16px; border-left: 4px solid #B8965A; padding-left: 16px; }
.day-block { background: #2C2C2C; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
.day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #D4AF7A; letter-spacing: 2px; margin-bottom: 12px; }
.warmup, .cooldown { font-size: 13px; color: #888; font-style: italic; margin: 8px 0; }
table { width: 100%; border-collapse: collapse; margin: 12px 0; }
th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #B8965A; padding: 8px; border-bottom: 1px solid #444; }
td { font-size: 14px; padding: 8px; border-bottom: 1px solid #333; color: #ddd; }
.macro-summary { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
.macro { background: #2C2C2C; padding: 16px 24px; border-radius: 8px; font-size: 14px; color: #aaa; }
.macro strong { color: #B8965A; font-size: 20px; display: block; margin-top: 4px; }
.meal-block { background: #2C2C2C; border-radius: 8px; padding: 20px; margin-bottom: 12px; }
.meal-block h4 { font-family: 'Bebas Neue', sans-serif; color: #D4AF7A; font-size: 18px; letter-spacing: 1px; margin-bottom: 8px; }
.meal-block ul { list-style: none; }
.meal-block li { padding: 4px 0; font-size: 14px; color: #ccc; }
.meal-block li::before { content: '→ '; color: #B8965A; }
.notes { background: #2C2C2C; border-left: 4px solid #B8965A; padding: 20px; margin-top: 24px; border-radius: 0 8px 8px 0; font-size: 14px; color: #ccc; line-height: 1.7; }
.footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #333; }
.footer p { font-size: 12px; color: #666; }
.footer .brand { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #B8965A; letter-spacing: 3px; margin-bottom: 8px; }
</style></head><body>
<div class="header">
  <h1>Fitness by Maddy</h1>
  <h2>Week ${weekNo} Program</h2>
  <p>${client.name} &middot; ${client.program.toUpperCase()} &middot; Generated ${new Date().toLocaleDateString()}</p>
</div>
<div class="section-title">Workout Plan</div>
${workoutHtml}
${workout.weekly_notes ? `<div class="notes"><strong>Weekly Notes:</strong> ${workout.weekly_notes}</div>` : ''}
<div class="section-title">Nutrition Plan</div>
${nutritionHtml}
${(nutrition.supplements || []).length > 0 ? `<div class="notes"><strong>Supplements:</strong> ${nutrition.supplements.join(', ')}</div>` : ''}
${nutrition.hydration ? `<div class="notes"><strong>Hydration:</strong> ${nutrition.hydration}</div>` : ''}
${plans.notes ? `<div class="section-title">Coach Notes</div><div class="notes">${plans.notes}</div>` : ''}
<div class="footer">
  <div class="brand">Fitness by Maddy</div>
  <p>This program is personalised for ${client.name}. Do not share or redistribute.</p>
</div>
</body></html>`;
}
