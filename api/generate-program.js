const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendDirect } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_KEYWORDS = [
  'extreme calorie', 'below 1000 cal', 'starvation', 'clenbuterol',
  'dnp', 'ephedrine', 'sarm', 'steroid', 'anabolic',
  'lose 10kg in 1 week', 'crash diet'
];

function isSafe(plan) {
  const text = JSON.stringify(plan).toLowerCase();
  return !SAFETY_KEYWORDS.some(kw => text.includes(kw));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: intakeFile } = await supabase.storage
      .from('clients')
      .download(`intakes/${client.lead_id}.json`);

    let intakeData = null;
    if (intakeFile) {
      try { intakeData = JSON.parse(await intakeFile.text()); } catch {}
    }

    const prompt = buildPrompt(client, recentCheckins || [], intakeData, week_no);

    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;
    let parsed;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch {
      parsed = { workout_plan: { raw: responseText }, nutrition_plan: {} };
    }

    if (!isSafe(parsed)) {
      await escalateToMaddy('Unsafe program content detected', {
        name: client.name,
        phone: client.phone,
        message: `Week ${week_no} program flagged for review`
      });
      return res.status(200).json({ action: 'flagged_for_review' });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || parsed,
      nutrition_plan: parsed.nutrition_plan || {},
      notes: parsed.notes || null,
      pdf_url: null
    }).select().single();

    if (error) throw error;

    const pdfContent = generatePdfHtml(client, parsed, week_no);
    const pdfPath = `${client_id}/week_${week_no}.html`;
    await supabase.storage.from('clients').upload(pdfPath, pdfContent, {
      contentType: 'text/html', upsert: true
    });

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);

    await supabase.from('programs').update({ pdf_url: urlData.publicUrl }).eq('id', program.id);

    await sendDirect(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Week ${week_no}`,
        parsed.notes || `Your Week ${week_no} program is ready!`
      ]
    });

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const parts = [
    'You are a NASM-certified fitness program architect for FitnessByMaddy.',
    'Create a detailed, science-backed weekly program customized for this client.',
    '',
    `CLIENT: ${client.name || 'Client'}`,
    `Program: ${client.program}`,
    `Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}`,
  ];

  if (intake) {
    parts.push('', 'INTAKE DATA:',
      `Age: ${intake.age}, Gender: ${intake.gender}`,
      `Height: ${intake.height}, Weight: ${intake.weight}`,
      `Goal: ${intake.goal}`,
      `Injuries: ${intake.injuries || 'None'}`,
      `Diet preference: ${intake.diet_pref || 'No restrictions'}`,
      `Schedule: ${intake.schedule || 'Flexible'}`,
      `Equipment: ${intake.equipment_access || 'Full gym'}`,
      `Experience: ${intake.experience_level || 'Intermediate'}`
    );
  }

  if (checkins.length > 0) {
    parts.push('', 'RECENT CHECK-INS:');
    for (const c of checkins) {
      parts.push(
        `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10`,
        `Issues: ${c.issues || 'None'}`
      );
    }
  }

  parts.push('',
    'OUTPUT FORMAT: Return valid JSON with this structure:',
    '```json',
    '{',
    '  "workout_plan": {',
    '    "days": [',
    '      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }',
    '    ],',
    '    "rest_days": ["Sunday"],',
    '    "cardio": "..."',
    '  },',
    '  "nutrition_plan": {',
    '    "calories": 2000,',
    '    "protein": 150,',
    '    "carbs": 200,',
    '    "fats": 65,',
    '    "meal_timing": "...",',
    '    "hydration": "...",',
    '    "supplements": []',
    '  },',
    '  "notes": "One-liner summary for WhatsApp"',
    '}',
    '```',
    '',
    'RULES:',
    '- Never recommend fewer than 1200 calories for women or 1500 for men',
    '- Never recommend banned substances or extreme protocols',
    '- Base progression on check-in data if available',
    '- Include warm-up and cool-down notes',
    '- Keep exercises practical for the client\'s equipment level'
  );

  return parts.join('\n');
}

function generatePdfHtml(client, plan, weekNo) {
  const workout = plan.workout_plan || {};
  const nutrition = plan.nutrition_plan || {};
  const days = workout.days || [];

  let daysHtml = '';
  for (const day of days) {
    let exercisesHtml = '';
    if (day.exercises) {
      for (const ex of day.exercises) {
        exercisesHtml += `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '60s'}</td><td>${ex.notes || ''}</td></tr>`;
      }
    }
    daysHtml += `
      <div class="day-block">
        <h3>${day.day} — ${day.focus || ''}</h3>
        <table><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr>${exercisesHtml}</table>
      </div>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#0a0a0a;color:#fff;padding:40px 24px}
.header{text-align:center;padding:40px 0;border-bottom:2px solid #B8965A}
.header h1{font-family:'Bebas Neue',sans-serif;font-size:48px;color:#B8965A;letter-spacing:4px}
.header h2{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#fff;letter-spacing:2px;margin-top:8px}
.header p{color:#888;font-size:14px;margin-top:8px}
.section{padding:32px 0}
.section h2{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A;letter-spacing:2px;margin-bottom:20px}
.day-block{background:#141414;border:1px solid #222;border-radius:8px;padding:24px;margin-bottom:16px}
.day-block h3{font-family:'Bebas Neue',sans-serif;font-size:22px;color:#B8965A;margin-bottom:12px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:8px;border-bottom:1px solid #333;color:#B8965A;font-size:12px;letter-spacing:1px;text-transform:uppercase}
td{padding:8px;border-bottom:1px solid #1a1a1a;color:#ccc;font-size:14px}
.macros{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}
.macro-box{background:#141414;border:1px solid #222;border-radius:8px;padding:20px;text-align:center}
.macro-box .num{font-family:'Bebas Neue',sans-serif;font-size:36px;color:#B8965A}
.macro-box .label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
.footer{text-align:center;padding:32px 0;border-top:1px solid #222;margin-top:32px;color:#555;font-size:12px}
@media print{body{background:#fff;color:#000}th{color:#B8965A}td{color:#333}.day-block{border-color:#ddd;background:#f9f9f9}.macro-box{background:#f9f9f9;border-color:#ddd}}
</style></head><body>
<div class="header">
  <h1>Fitness by Maddy</h1>
  <h2>Week ${weekNo} Program</h2>
  <p>${client.name || 'Client'} &middot; ${client.program} &middot; Generated ${new Date().toLocaleDateString()}</p>
</div>
<div class="section"><h2>Nutrition</h2>
  <div class="macros">
    <div class="macro-box"><div class="num">${nutrition.calories || '—'}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="num">${nutrition.protein || '—'}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="num">${nutrition.carbs || '—'}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="num">${nutrition.fats || '—'}g</div><div class="label">Fats</div></div>
  </div>
  ${nutrition.meal_timing ? `<p style="color:#aaa;font-size:14px">${nutrition.meal_timing}</p>` : ''}
  ${nutrition.hydration ? `<p style="color:#aaa;font-size:14px;margin-top:8px">${nutrition.hydration}</p>` : ''}
</div>
<div class="section"><h2>Workout Plan</h2>${daysHtml}
  ${workout.cardio ? `<p style="color:#aaa;margin-top:16px"><strong style="color:#B8965A">Cardio:</strong> ${workout.cardio}</p>` : ''}
  ${workout.rest_days ? `<p style="color:#aaa;margin-top:8px"><strong style="color:#B8965A">Rest Days:</strong> ${workout.rest_days.join(', ')}</p>` : ''}
</div>
<div class="footer">Fitness by Maddy &middot; fitnessbymaddy.com &middot; This program is for personal use only.</div>
</body></html>`;
}
