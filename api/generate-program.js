const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { cors, parseBody } = require('../lib/helpers');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /steroids?\b/i,
  /sarms?\b/i,
  /lose\s*\d{2,}\s*kg\s*in\s*1\s*week/i,
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const { client_id, week_no } = body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: intake } = await supabase
    .from('intake_forms')
    .select('*')
    .eq('lead_id', client.lead_id)
    .single();

  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const Anthropic = require('@anthropic-ai/sdk');
  const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const prompt = buildPrompt(client, intake, recentCheckins, week_no);

  let programContent;
  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });
    programContent = response.content[0].text;
  } catch (err) {
    return res.status(500).json({ error: 'Claude API failed' });
  }

  const isRisky = RISKY_PATTERNS.some(p => p.test(programContent));
  if (isRisky) {
    const { escalateToMaddy } = require('../lib/escalate');
    await escalateToMaddy('Risky program content flagged', {
      client_id,
      week_no,
      phone: client.phone,
    }, { supabase });
    return res.status(200).json({ ok: false, flagged: true, reason: 'Content flagged for review' });
  }

  let workoutPlan, nutritionPlan, notes;
  try {
    const parsed = JSON.parse(programContent);
    workoutPlan = parsed.workout || parsed.workout_plan || {};
    nutritionPlan = parsed.nutrition || parsed.nutrition_plan || {};
    notes = parsed.notes || parsed.coach_notes || '';
  } catch {
    workoutPlan = { raw: programContent };
    nutritionPlan = {};
    notes = '';
  }

  const pdfHtml = renderProgramPdf(client, week_no, workoutPlan, nutritionPlan, notes);
  const pdfBlob = new Blob([pdfHtml], { type: 'text/html' });
  const pdfPath = `clients/${client.id}/week_${week_no}.html`;

  await supabase.storage
    .from('client-files')
    .upload(pdfPath, pdfBlob, { upsert: true });

  const { data: urlData } = supabase.storage
    .from('client-files')
    .getPublicUrl(pdfPath);

  const pdfUrl = urlData?.publicUrl || pdfPath;

  const { error } = await supabase.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    whatsapp_sent_at: null,
    workout_plan: workoutPlan,
    nutrition_plan: nutritionPlan,
    notes,
  });

  if (error) {
    return res.status(500).json({ error: 'Failed to save program' });
  }

  await sendTemplate(client.phone, 'weekly_program', [
    client.name || 'there',
    `Week ${week_no}`,
    pdfUrl,
  ], { supabase });

  await supabase
    .from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
};

function buildPrompt(client, intake, checkins, weekNo) {
  const clientProfile = intake ? `
Client: ${intake.name || client.name}
Age: ${intake.age || 'unknown'}, Gender: ${intake.gender || 'unknown'}
Height: ${intake.height_cm || '?'}cm, Weight: ${intake.weight_kg || '?'}kg
Goal: ${intake.goal || 'general fitness'}
Injuries: ${intake.injuries || 'none reported'}
Medical: ${intake.medical_conditions || 'none'}
Diet: ${intake.diet_preference || 'no preference'}
Experience: ${intake.training_experience || 'beginner'}
Equipment: ${intake.equipment_access || 'full gym'}
Days/week: ${intake.days_per_week || 4}
` : `Client: ${client.name}, Program: ${client.program}`;

  let checkinSummary = 'No previous check-ins.';
  if (checkins && checkins.length > 0) {
    checkinSummary = checkins.map(c =>
      `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, ` +
      `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
    ).join('\n');
  }

  return `You are an expert fitness coach creating a personalized weekly program.

${clientProfile}

Recent check-ins:
${checkinSummary}

Create Week ${weekNo} program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "day_1": { "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}] },
    "day_2": { ... },
    ...
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 170,
    "carbs_g": 250,
    "fat_g": 70,
    "meal_1": "...",
    "meal_2": "...",
    "meal_3": "...",
    "meal_4": "...",
    "hydration": "...",
    "supplements": "..."
  },
  "notes": "Coach notes for this week..."
}

Rules:
- Base progressive overload on check-in data
- Never go below 1400 calories for women or 1600 for men
- Never recommend banned substances, extreme diets, or unrealistic timelines
- Adjust volume/intensity based on compliance and energy scores
- If injuries are reported, work around them safely
- Keep it evidence-based and practical`;
}

function renderProgramPdf(client, weekNo, workout, nutrition, notes) {
  const workoutHtml = Object.entries(workout)
    .filter(([key]) => key.startsWith('day_') || key.startsWith('Day'))
    .map(([day, data]) => {
      const exercises = (data.exercises || []).map(ex =>
        `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '60s'}</td><td>${ex.notes || ''}</td></tr>`
      ).join('');
      return `
        <div class="day-block">
          <h3>${day.replace('_', ' ').toUpperCase()} — ${data.focus || ''}</h3>
          <table><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr>${exercises}</table>
        </div>`;
    }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #111; color: #fff; padding: 40px; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 32px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; margin: 32px 0 16px; letter-spacing: 2px; }
  .day-block { background: #1a1a1a; padding: 24px; border-radius: 8px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #B8965A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #B8965A; border-bottom: 1px solid #333; }
  td { padding: 8px; font-size: 14px; color: #ddd; border-bottom: 1px solid #222; }
  .nutrition-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 16px; }
  .nutrition-card { background: #1a1a1a; padding: 20px; border-radius: 8px; }
  .nutrition-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #B8965A; }
  .nutrition-card .value { font-family: 'Bebas Neue', sans-serif; font-size: 32px; margin-top: 4px; }
  .notes { background: #1a1a1a; padding: 24px; border-radius: 8px; margin-top: 24px; border-left: 3px solid #B8965A; }
  .footer { text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid #333; color: #555; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>${client.name || 'Client'} — WEEK ${weekNo}</h2>
    <p>${client.program || '12-Week Custom'} Program</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${workoutHtml || '<p style="color:#888;">Workout plan details in your app.</p>'}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition-grid">
    <div class="nutrition-card"><div class="label">Daily Calories</div><div class="value">${nutrition.calories || '—'}</div></div>
    <div class="nutrition-card"><div class="label">Protein</div><div class="value">${nutrition.protein_g || '—'}g</div></div>
    <div class="nutrition-card"><div class="label">Carbs</div><div class="value">${nutrition.carbs_g || '—'}g</div></div>
    <div class="nutrition-card"><div class="label">Fat</div><div class="value">${nutrition.fat_g || '—'}g</div></div>
  </div>

  ${notes ? `<div class="notes"><strong style="color:#B8965A;">Coach Notes:</strong><br><br>${notes}</div>` : ''}

  <div class="footer">
    FITNESS BY MADDY &bull; fitnessbymaddy.com &bull; @fitnessbymaddy_
  </div>
</body>
</html>`;
}
