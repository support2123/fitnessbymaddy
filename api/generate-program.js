const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  '30 day transformation', 'lose 20kg in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    try {
      const { data: intakeFile } = await supabase.storage
        .from('clients')
        .download(`intakes/${client.lead_id}.json`);
      if (intakeFile) {
        intakeData = JSON.parse(await intakeFile.text());
      }
    } catch {}

    const anthropic = new Anthropic();

    const systemPrompt = `You are Maddy's AI program architect for FitnessByMaddy.
You create weekly personalized workout and nutrition plans.

RULES:
- Be evidence-based and safe. No extreme calorie deficits (<1200 for women, <1500 for men).
- No banned substances or supplements beyond basic (whey, creatine, multivitamin).
- Realistic timelines only. Never promise specific weight loss numbers.
- Consider injuries, medical conditions, and preferences from intake data.
- Output must be valid JSON with "workout_plan" and "nutrition_plan" keys.
- Warm, expert tone. Encouraging but never bro-sciency.

WORKOUT PLAN FORMAT:
{
  "workout_plan": {
    "focus": "string describing this week's focus",
    "days": [
      {
        "day": "Monday",
        "type": "Upper Body Strength",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
        ],
        "duration_min": 45,
        "warmup": "...",
        "cooldown": "..."
      }
    ]
  }
}

NUTRITION PLAN FORMAT:
{
  "nutrition_plan": {
    "daily_calories": 1800,
    "macros": { "protein_g": 140, "carbs_g": 180, "fat_g": 60 },
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "notes": "..." }
    ],
    "hydration": "...",
    "supplements": ["..."]
  }
}`;

    const userPrompt = buildUserPrompt(client, recentCheckins, intakeData, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(422).json({ error: 'Failed to parse program JSON' });
    }

    const outputStr = JSON.stringify(parsed);
    const hasSafetyFlag = SAFETY_FLAGS.some(flag =>
      outputStr.toLowerCase().includes(flag)
    );

    if (hasSafetyFlag) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        'Program safety flag triggered',
        client.phone,
        `Week ${week_no} program for ${client.name} flagged for review`
      );
      return res.status(200).json({
        ok: false,
        reason: 'safety_flagged',
        message: 'Program flagged for Maddy review',
      });
    }

    const pdfContent = generatePDFHtml(client, week_no, parsed);
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfContent, {
        contentType: 'text/html',
        upsert: true,
      });

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const { error: insertError } = await supabase
      .from('programs')
      .upsert({
        client_id,
        week_no: parseInt(week_no),
        generated_at: new Date().toISOString(),
        pdf_url: urlData.publicUrl,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.notes || null,
      }, { onConflict: 'client_id,week_no' });

    if (insertError) throw insertError;

    const weekFocus = parsed.workout_plan?.focus || `Week ${week_no} program`;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      weekFocus,
      urlData.publicUrl,
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('[generate-program]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, checkins, intake, weekNo) {
  let prompt = `Generate Week ${weekNo} program for:\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `\nINTAKE DATA:\n`;
    prompt += `Age: ${intake.age || 'N/A'}, Gender: ${intake.gender || 'N/A'}\n`;
    prompt += `Height: ${intake.height || 'N/A'}, Starting Weight: ${intake.weight || 'N/A'}\n`;
    prompt += `Goal: ${intake.goal || 'N/A'}\n`;
    prompt += `Injuries: ${intake.injuries || 'None reported'}\n`;
    prompt += `Medical: ${intake.medical_conditions || 'None'}\n`;
    prompt += `Diet Preference: ${intake.diet_preference || 'No preference'}\n`;
    prompt += `Schedule: ${intake.schedule || 'Flexible'}\n`;
    prompt += `Experience: ${intake.workout_experience || 'N/A'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRECENT CHECK-INS:\n`;
    for (const c of checkins) {
      prompt += `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, `;
      prompt += `Waist ${c.waist || 'N/A'}cm, `;
      prompt += `Compliance ${c.compliance_score || 'N/A'}/10, `;
      prompt += `Energy ${c.energy || 'N/A'}/10\n`;
      if (c.issues) prompt += `  Issues: ${c.issues}\n`;
      if (c.next_week_focus) prompt += `  Previous focus: ${c.next_week_focus}\n`;
    }
  }

  prompt += `\nReturn ONLY valid JSON with workout_plan and nutrition_plan.`;
  return prompt;
}

function generatePDFHtml(client, weekNo, plan) {
  const workout = plan.workout_plan || {};
  const nutrition = plan.nutrition_plan || {};

  let daysHtml = '';
  if (workout.days) {
    for (const day of workout.days) {
      let exercisesHtml = '';
      if (day.exercises) {
        for (const ex of day.exercises) {
          exercisesHtml += `<tr>
            <td>${ex.name}</td>
            <td>${ex.sets} x ${ex.reps}</td>
            <td>${ex.rest || '-'}</td>
            <td>${ex.notes || '-'}</td>
          </tr>`;
        }
      }
      daysHtml += `
        <div class="day-block">
          <h3>${day.day} — ${day.type || ''}</h3>
          ${day.warmup ? `<p class="note">Warmup: ${day.warmup}</p>` : ''}
          <table>
            <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
            <tbody>${exercisesHtml}</tbody>
          </table>
          ${day.cooldown ? `<p class="note">Cooldown: ${day.cooldown}</p>` : ''}
          ${day.duration_min ? `<p class="note">Duration: ~${day.duration_min} min</p>` : ''}
        </div>`;
    }
  }

  let mealsHtml = '';
  if (nutrition.meals) {
    for (const meal of nutrition.meals) {
      const options = (meal.options || []).map(o => `<li>${o}</li>`).join('');
      mealsHtml += `
        <div class="meal-block">
          <h4>${meal.meal}</h4>
          <ul>${options}</ul>
          ${meal.notes ? `<p class="note">${meal.notes}</p>` : ''}
        </div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px 24px; }
.container { max-width: 800px; margin: 0 auto; }
.header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
.header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
.header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
.header p { color: #999; font-size: 14px; margin-top: 8px; }
.section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 2px; margin: 40px 0 20px; padding-bottom: 8px; border-bottom: 1px solid #333; }
.focus { background: #222; padding: 16px 20px; border-left: 3px solid #B8965A; margin-bottom: 24px; font-size: 15px; color: #ccc; }
.day-block { background: #222; border-radius: 4px; padding: 20px; margin-bottom: 16px; }
.day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #B8965A; margin-bottom: 12px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #B8965A; padding: 8px; border-bottom: 1px solid #444; }
td { padding: 8px; font-size: 14px; color: #ddd; border-bottom: 1px solid #333; }
.note { font-size: 13px; color: #999; margin-top: 8px; font-style: italic; }
.macros { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
.macro-box { background: #222; padding: 16px; text-align: center; border-radius: 4px; }
.macro-box .num { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
.macro-box .label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; }
.meal-block { background: #222; padding: 16px 20px; border-radius: 4px; margin-bottom: 12px; }
.meal-block h4 { font-family: 'Bebas Neue', sans-serif; font-size: 18px; color: #B8965A; margin-bottom: 8px; }
.meal-block ul { list-style: none; }
.meal-block li { padding: 4px 0; font-size: 14px; color: #ddd; }
.meal-block li::before { content: '→ '; color: #B8965A; }
.footer { text-align: center; margin-top: 60px; padding-top: 20px; border-top: 1px solid #333; color: #666; font-size: 12px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name || 'Client'} · ${new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>
  </div>

  ${workout.focus ? `<div class="focus">${workout.focus}</div>` : ''}

  <div class="section-title">WORKOUT PLAN</div>
  ${daysHtml}

  <div class="section-title">NUTRITION PLAN</div>
  ${nutrition.daily_calories ? `<p style="font-size:15px;color:#ccc;margin-bottom:16px;">Daily Target: ${nutrition.daily_calories} kcal</p>` : ''}

  ${nutrition.macros ? `
  <div class="macros">
    <div class="macro-box"><div class="num">${nutrition.macros.protein_g || 0}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="num">${nutrition.macros.carbs_g || 0}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="num">${nutrition.macros.fat_g || 0}g</div><div class="label">Fat</div></div>
  </div>` : ''}

  ${mealsHtml}

  ${nutrition.hydration ? `<p style="margin-top:16px;font-size:14px;color:#ccc;">Hydration: ${nutrition.hydration}</p>` : ''}
  ${nutrition.supplements ? `<p style="margin-top:8px;font-size:14px;color:#ccc;">Supplements: ${nutrition.supplements.join(', ')}</p>` : ''}

  <div class="footer">
    <p>FITNESS BY MADDY · fitnessbymaddy.com</p>
    <p>This program is personalized for you. Do not share or redistribute.</p>
  </div>
</div>
</body>
</html>`;
}
