const Anthropic = require('@anthropic-ai/sdk');
const { getClientById, getRecentCheckins, insertProgram, getClient } = require('../lib/supabase');
const { sendMediaTemplate } = require('../lib/whatsapp');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*(10|15|20)\+?\s*(kg|lb).*in\s*(1|2)\s*week/i,
  /extreme\s*cut/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing CLAUDE_API_KEY' });

    const client = await getClientById(client_id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const checkins = await getRecentCheckins(client_id, 2);

    const db = getClient();
    const { data: intake } = await db
      .from('lead_intake')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const prompt = buildPrompt(client, intake, checkins, week_no);

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(content)) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy('Risky program content flagged', {
          phone: client.phone,
          name: client.name,
          message: `Week ${week_no} program flagged for: ${pattern.source}`,
        });
        return res.status(200).json({ flagged: true, reason: pattern.source });
      }
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
      parsed = JSON.parse(jsonMatch[1]);
    } catch {
      parsed = { workout_plan: content, nutrition_plan: '' };
    }

    const pdfHtml = renderProgramPdf(client, parsed, week_no);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: publicUrl } = db.storage.from('client-files').getPublicUrl(pdfPath);

    const program = await insertProgram({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl.publicUrl,
      whatsapp_sent_at: null,
      workout_plan: parsed.workout_plan || parsed,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.notes || null,
    });

    await sendMediaTemplate(client.phone, 'weekly_program', publicUrl.publicUrl, [
      client.name || 'there',
      `Week ${week_no}`,
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a NASM-certified fitness program architect for FitnessByMaddy.
Generate a Week ${weekNo} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intake ? `- Age: ${intake.age}, Gender: ${intake.gender}
- Goal: ${intake.goal}
- Injuries/limitations: ${intake.injuries || 'None'}
- Diet preference: ${intake.diet_preference || 'No preference'}
- Training experience: ${intake.training_experience || 'Beginner'}
- Current weight: ${intake.current_weight || 'N/A'}kg
- Target weight: ${intake.target_weight || 'N/A'}kg` : '- No intake form data available'}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}kg
- Waist: ${lastCheckin.waist || 'N/A'}cm
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}kg
- Compliance: ${prevCheckin.compliance_score}/10` : ''}

RULES:
- Safe, evidence-based programming only
- No extreme calorie restrictions (minimum 1200 kcal for women, 1500 for men)
- No banned substances or supplements
- Realistic weekly progress expectations (0.5-1kg fat loss max)
- Account for any injuries or limitations
- Progressive overload from previous weeks

Return JSON with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""}] },
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "meal_timing": ["..."],
    "sample_meals": [{"meal": "Breakfast", "options": ["..."]}],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-liner coaching note for the week"
}
\`\`\``;
}

function renderProgramPdf(client, plan, weekNo) {
  const workoutRows = (plan.workout_plan?.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `<div class="day-block">
      <h3>${day.day} — ${day.focus || ''}</h3>
      <table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
      <tbody>${exercises}</tbody></table></div>`;
  }).join('');

  const nutrition = plan.nutrition_plan || {};

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#fff;padding:40px 24px}
h1,h2,h3{font-family:'Bebas Neue',sans-serif;letter-spacing:2px}
h1{font-size:36px;color:#D4AF7A;margin-bottom:8px}
h2{font-size:24px;color:#D4AF7A;margin:32px 0 16px;border-bottom:1px solid #333;padding-bottom:8px}
h3{font-size:18px;color:#fff;margin-bottom:12px}
.header{text-align:center;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid #D4AF7A}
.subtitle{font-size:14px;color:#999;letter-spacing:1px}
.day-block{background:#222;border-radius:8px;padding:20px;margin-bottom:16px;border-left:3px solid #D4AF7A}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#D4AF7A;padding:8px 4px;border-bottom:1px solid #333;font-size:11px;text-transform:uppercase;letter-spacing:1px}
td{padding:8px 4px;border-bottom:1px solid #2a2a2a;color:#ccc}
.macro-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
.macro-box{background:#222;padding:16px;border-radius:8px;text-align:center}
.macro-val{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#D4AF7A}
.macro-label{font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px}
.notes{background:#222;border-left:3px solid #D4AF7A;padding:16px;margin-top:24px;border-radius:0 8px 8px 0;font-style:italic;color:#ccc}
.footer{text-align:center;margin-top:40px;padding-top:24px;border-top:1px solid #333;font-size:12px;color:#666}
@media(max-width:500px){.macro-grid{grid-template-columns:repeat(2,1fr)}}
</style></head><body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <div class="subtitle">Week ${weekNo} Program — ${client.name || 'Client'}</div>
</div>
<h2>WORKOUT PLAN</h2>
${workoutRows || '<p style="color:#999">Workout plan details will be provided separately.</p>'}
${nutrition.calories ? `<h2>NUTRITION PLAN</h2>
<div class="macro-grid">
  <div class="macro-box"><div class="macro-val">${nutrition.calories}</div><div class="macro-label">Calories</div></div>
  <div class="macro-box"><div class="macro-val">${nutrition.protein_g}g</div><div class="macro-label">Protein</div></div>
  <div class="macro-box"><div class="macro-val">${nutrition.carbs_g}g</div><div class="macro-label">Carbs</div></div>
  <div class="macro-box"><div class="macro-val">${nutrition.fat_g}g</div><div class="macro-label">Fat</div></div>
</div>` : ''}
${plan.notes ? `<div class="notes">${plan.notes}</div>` : ''}
<div class="footer">fitnessbymaddy.com | Coaching that actually works</div>
</body></html>`;
}
