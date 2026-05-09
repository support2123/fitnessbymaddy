const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const prompt = buildProgramPrompt(client, recentCheckins || [], prevPrograms?.[0], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', errText);
      return res.status(502).json({ error: 'AI generation failed' });
    }

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text || '';

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(content);
      workoutPlan = parsed.workout_plan;
      nutritionPlan = parsed.nutrition_plan;
      notes = parsed.notes;
    } catch {
      workoutPlan = { raw: content };
      nutritionPlan = {};
      notes = 'Auto-parsed from free text';
    }

    if (containsRiskyContent(content)) {
      await sendWhatsApp(
        '+917082478374',
        `REVIEW NEEDED: Program for ${client.name || client.phone} Week ${week_no} flagged for risky content. Please review before sending.`
      );

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes: 'FLAGGED FOR REVIEW: ' + (notes || ''),
      });

      return res.status(200).json({ ok: true, flagged: true });
    }

    const pdfHtml = renderProgramPDF(client, week_no, workoutPlan, nutritionPlan, notes);

    const pdfPath = `${client.folder_url || `clients/${client_id}`}/week_${week_no}.html`;
    await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfHtml, {
        contentType: 'text/html',
        upsert: true,
      });

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfPath,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes,
      })
      .select()
      .single();

    const weekMsg = `Your Week ${week_no} program is ready! Check your email for the full plan. Let's crush this week!`;
    await sendWhatsApp(client.phone, weekMsg);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, programId: program.id });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, prevProgram, weekNo) {
  const checkinSummary = checkins.map(c => `
    Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm,
    Compliance ${c.compliance_score}/10, Energy ${c.energy}/10,
    Issues: ${c.issues || 'None'}
  `).join('\n');

  const prevSummary = prevProgram
    ? `Previous program notes: ${prevProgram.notes || 'None'}`
    : 'This is the first week.';

  return `You are a certified personal trainer and nutrition coach creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (first week).'}

${prevSummary}

INSTRUCTIONS:
1. Create a 7-day workout plan appropriate for the client's progress
2. Create a daily nutrition plan with meals, macros, and calories
3. Add coaching notes and focus areas for the week
4. Progressively adjust based on compliance and energy levels
5. If compliance is low, simplify. If energy is high, increase intensity.

SAFETY RULES:
- Never recommend less than 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme diets
- Never suggest training through pain or injury
- Always include rest days (minimum 1-2 per week)
- Keep protein at 1.6-2.2g per kg bodyweight

Respond ONLY with valid JSON in this exact format:
{
  "workout_plan": {
    "day_1": { "name": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "90s" }] },
    "day_2": { ... },
    ...
    "day_7": { "name": "Rest Day", "exercises": [] }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "name": "Breakfast", "description": "...", "calories": 500 },
      ...
    ]
  },
  "notes": "Coaching notes for the week..."
}`;
}

function containsRiskyContent(text) {
  const lower = text.toLowerCase();
  const riskyPatterns = [
    /\b(less than|under|below)\s*(1[0-1]\d{2}|[1-9]\d{2})\s*cal/,
    /\bsteroids?\b/, /\bclenbuterol\b/, /\bdnp\b/, /\bsarms?\b/,
    /\bephedra\b/, /\bamphetamine\b/,
    /\bcrash\s*diet\b/, /\bstarvation\b/,
    /\b(lose|drop)\s*(10|15|20)\+?\s*(kg|lbs?|pounds?)\s*(in|per)\s*(1|one|a)\s*week/,
  ];
  return riskyPatterns.some(p => p.test(lower));
}

function renderProgramPDF(client, weekNo, workout, nutrition, notes) {
  const workoutHtml = Object.entries(workout || {}).map(([day, data]) => {
    if (!data || !data.exercises) return '';
    const exercises = (data.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '-'}</td></tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.replace('_', ' ').toUpperCase()} — ${data.name || ''}</h3>
        <table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th></tr></thead>
        <tbody>${exercises}</tbody></table>
      </div>`;
  }).join('');

  const mealsHtml = (nutrition?.meals || []).map(m =>
    `<div class="meal"><strong>${m.name}</strong>: ${m.description} <span class="cal">(${m.calories} cal)</span></div>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#f5f5f5;padding:40px 24px}
.header{text-align:center;margin-bottom:48px;padding-bottom:32px;border-bottom:2px solid #B8965A}
h1{font-family:'Bebas Neue',sans-serif;font-size:48px;color:#B8965A;letter-spacing:4px}
h2{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A;letter-spacing:2px;margin:32px 0 16px}
h3{font-family:'Bebas Neue',sans-serif;font-size:22px;color:#D4AF7A;margin-bottom:12px}
.subtitle{color:#888;font-size:14px;letter-spacing:2px;text-transform:uppercase}
.day-block{background:#222;padding:24px;border-radius:8px;margin-bottom:16px;border-left:3px solid #B8965A}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 12px;font-size:14px}
th{color:#B8965A;border-bottom:1px solid #333;font-size:12px;text-transform:uppercase;letter-spacing:1px}
td{border-bottom:1px solid #2a2a2a;color:#ccc}
.nutrition-box{background:#222;padding:24px;border-radius:8px;border-left:3px solid #B8965A}
.macros{display:flex;gap:24px;margin:16px 0;flex-wrap:wrap}
.macro{background:#2a2a2a;padding:16px;border-radius:8px;text-align:center;flex:1;min-width:100px}
.macro-val{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A}
.macro-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px}
.meal{padding:12px 0;border-bottom:1px solid #2a2a2a;font-size:14px;color:#ccc}
.meal strong{color:#f5f5f5}
.cal{color:#B8965A;font-size:12px}
.notes{background:#1e2a1e;padding:24px;border-radius:8px;margin-top:32px;border-left:3px solid #4a7c4a;color:#b5d4b5;font-size:14px;line-height:1.8}
.footer{text-align:center;margin-top:48px;padding-top:24px;border-top:1px solid #333;color:#555;font-size:12px}
</style></head><body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <div class="subtitle">Week ${weekNo} Program for ${client.name || 'Client'}</div>
</div>
<h2>WORKOUT PLAN</h2>
${workoutHtml || '<p style="color:#888">Workout plan will be provided separately.</p>'}
<h2>NUTRITION PLAN</h2>
<div class="nutrition-box">
  <div class="macros">
    <div class="macro"><div class="macro-val">${nutrition?.calories || '-'}</div><div class="macro-label">Calories</div></div>
    <div class="macro"><div class="macro-val">${nutrition?.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro"><div class="macro-val">${nutrition?.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro"><div class="macro-val">${nutrition?.fat_g || '-'}g</div><div class="macro-label">Fat</div></div>
  </div>
  ${mealsHtml || '<p style="color:#888">Meal plan details coming soon.</p>'}
</div>
${notes ? `<div class="notes"><strong>Coach Notes:</strong><br>${notes}</div>` : ''}
<div class="footer">Fitness by Maddy &copy; ${new Date().getFullYear()} | fitnessbymaddy.com</div>
</body></html>`;
}
