const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendDocument } = require('./_lib/whatsapp');
const { maskPhone, corsHeaders } = require('./_lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in a week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .limit(1)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'program already exists for this week' });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create weekly personalized workout and nutrition plans.

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 kcal for men)
- Never recommend banned or dangerous substances
- Never promise unrealistic timelines
- Base progressions on check-in data
- Account for injuries and limitations
- Include warm-up and cool-down in every session
- Adjust intensity based on compliance and energy scores

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..."}
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      {"meal": "Breakfast", "options": ["..."], "notes": "..."}
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": "..."
  },
  "weekly_notes": "..."
}`;

    const checkinSummary = (recentCheckins || []).map(c =>
      `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    ).join('\n');

    const userPrompt = `Generate Week ${week_no} program for this client:

Name: ${client.name || 'Client'}
Program: ${client.program}
Age: ${client.age || 'unknown'}
Goal: ${client.goal || 'general fitness'}
Injuries/Limitations: ${client.injuries || 'none reported'}
Diet Preference: ${client.diet_pref || 'no preference'}
Schedule: ${client.schedule || 'flexible'}

Recent Check-in Data:
${checkinSummary || 'No check-ins yet (Week 1)'}

Generate an appropriate Week ${week_no} plan with progressive overload from previous weeks.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const aiText = response.content[0]?.text || '';

    for (const flag of SAFETY_FLAGS) {
      if (aiText.toLowerCase().includes(flag)) {
        const { escalate } = require('./_lib/escalation');
        await escalate(
          client.phone,
          `Safety flag in generated program: "${flag}"`,
          `Week ${week_no} program for ${maskPhone(client.phone)} flagged`,
          client_id
        );
        return res.status(200).json({
          success: false,
          flagged: true,
          reason: `Safety flag: ${flag}`,
        });
      }
    }

    let parsed;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
    } catch {
      console.error('[GENERATE] Failed to parse AI response');
      return res.status(500).json({ error: 'ai_response_parse_failed' });
    }

    const programHtml = renderProgramHtml(client, week_no, parsed);
    const fileName = `week_${week_no}.html`;
    const filePath = `${client.folder_url || `clients/${client_id}`}/${fileName}`;

    const htmlBlob = new Blob([programHtml], { type: 'text/html' });
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, htmlBlob, { contentType: 'text/html', upsert: true });

    let publicUrl = '';
    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from('programs')
        .getPublicUrl(filePath);
      publicUrl = urlData?.publicUrl || '';
    }

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: publicUrl,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.weekly_notes,
      })
      .select()
      .single();

    if (publicUrl) {
      const weekNote = parsed.weekly_notes || `Your Week ${week_no} program is ready!`;
      await sendDocument(client.phone, publicUrl, weekNote.slice(0, 200));

      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    console.log(`[GENERATE] Week ${week_no} for ${maskPhone(client.phone)} complete`);
    return res.status(200).json({ success: true, program_id: program.id, url: publicUrl });
  } catch (err) {
    console.error('[GENERATE ERROR]', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};

function renderProgramHtml(client, weekNo, plan) {
  const workout = plan.workout_plan || {};
  const nutrition = plan.nutrition_plan || {};
  const days = workout.days || [];

  const workoutRows = days.map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.day} — ${day.focus}</h3>
        <p class="warmup">Warm-up: ${day.warmup || '5 min general'}</p>
        <table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
        <tbody>${exercises}</tbody></table>
        <p class="cooldown">Cool-down: ${day.cooldown || '5 min stretching'}</p>
      </div>`;
  }).join('');

  const meals = (nutrition.meals || []).map(m =>
    `<div class="meal"><strong>${m.meal}:</strong> ${(m.options || []).join(' / ')}${m.notes ? ` <em>(${m.notes})</em>` : ''}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#e0e0e0;padding:24px;max-width:800px;margin:0 auto}
.header{text-align:center;padding:40px 20px;border-bottom:2px solid #B8965A;margin-bottom:32px}
.header h1{font-family:'Bebas Neue',sans-serif;font-size:48px;color:#B8965A;letter-spacing:4px}
.header h2{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#fff;letter-spacing:2px;margin-top:8px}
.header p{color:#888;font-size:14px;margin-top:8px}
.section-title{font-family:'Bebas Neue',sans-serif;font-size:24px;color:#B8965A;letter-spacing:2px;margin:32px 0 16px;border-bottom:1px solid #333;padding-bottom:8px}
.day-block{background:#222;border-radius:8px;padding:20px;margin-bottom:16px;border-left:3px solid #B8965A}
.day-block h3{font-family:'Bebas Neue',sans-serif;font-size:20px;color:#fff;letter-spacing:1px;margin-bottom:12px}
.warmup,.cooldown{font-size:13px;color:#B8965A;margin:8px 0;font-style:italic}
table{width:100%;border-collapse:collapse;margin:12px 0}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;padding:8px;border-bottom:1px solid #333}
td{padding:8px;font-size:14px;border-bottom:1px solid #2a2a2a}
.nutrition{background:#222;border-radius:8px;padding:24px;border-left:3px solid #B8965A}
.macros{display:flex;gap:24px;margin:16px 0;flex-wrap:wrap}
.macro{text-align:center;flex:1;min-width:80px}
.macro .num{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A}
.macro .label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px}
.meal{padding:8px 0;border-bottom:1px solid #2a2a2a;font-size:14px}
.meal:last-child{border:none}
.notes{background:#1e1e1e;border:1px solid #333;border-radius:8px;padding:20px;margin-top:24px;font-size:14px;line-height:1.7;color:#ccc}
.footer{text-align:center;margin-top:40px;padding-top:20px;border-top:1px solid #333;color:#555;font-size:12px}
</style>
</head>
<body>
<div class="header">
  <h1>Fitness by Maddy</h1>
  <h2>Week ${weekNo} Program</h2>
  <p>${client.name || 'Client'} &bull; ${client.program?.toUpperCase() || 'Custom'}</p>
</div>

<div class="section-title">Workout Plan</div>
${workoutRows || '<p>Rest week — active recovery only</p>'}
${workout.notes ? `<div class="notes"><strong>Trainer Notes:</strong> ${workout.notes}</div>` : ''}

<div class="section-title">Nutrition Plan</div>
<div class="nutrition">
  <div class="macros">
    <div class="macro"><div class="num">${nutrition.daily_calories || '—'}</div><div class="label">Calories</div></div>
    <div class="macro"><div class="num">${nutrition.protein_g || '—'}g</div><div class="label">Protein</div></div>
    <div class="macro"><div class="num">${nutrition.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
    <div class="macro"><div class="num">${nutrition.fat_g || '—'}g</div><div class="label">Fat</div></div>
  </div>
  ${meals}
  ${nutrition.hydration ? `<div class="meal"><strong>Hydration:</strong> ${nutrition.hydration}</div>` : ''}
  ${(nutrition.supplements || []).length ? `<div class="meal"><strong>Supplements:</strong> ${nutrition.supplements.join(', ')}</div>` : ''}
  ${nutrition.notes ? `<div class="notes"><strong>Nutrition Notes:</strong> ${nutrition.notes}</div>` : ''}
</div>

${plan.weekly_notes ? `<div class="section-title">Weekly Notes</div><div class="notes">${plan.weekly_notes}</div>` : ''}

<div class="footer">
  Fitness by Maddy &bull; fitnessbymaddy.com &bull; Generated ${new Date().toLocaleDateString('en-IN')}
</div>
</body>
</html>`;
}
