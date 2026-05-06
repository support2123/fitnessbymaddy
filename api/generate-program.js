const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
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

  const { data: lead } = await db
    .from('leads')
    .select('intake_data')
    .eq('id', client.lead_id)
    .single();

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
Create weekly workout and nutrition plans that are:
- Evidence-based and safe
- Progressive (building on previous weeks)
- Tailored to the client's goals, experience, and constraints
- Never extreme (no sub-1200 cal diets, no banned substances, no unrealistic timelines)

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name":"...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""}] }
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "sample_meals": ["...", "..."],
    "supplements": ["..."],
    "notes": "..."
  },
  "weekly_notes": "..."
}`;

  const userPrompt = `Client: ${client.name}
Program: ${client.program} (Week ${week_no})
Intake data: ${JSON.stringify(lead?.intake_data || {})}
Recent check-ins: ${JSON.stringify(recentCheckins || [])}

Generate Week ${week_no} program. Adjust based on check-in data (compliance, energy, issues).`;

  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate program', detail: err.message });
  }

  if (isFlagged(programData)) {
    await notifyMaddy(`REVIEW NEEDED: Week ${week_no} program for ${client.name} flagged for safety concerns.`);
    return res.status(200).json({ flagged: true, message: 'Program flagged for review' });
  }

  const pdfHtml = renderProgramPDF(client, week_no, programData);
  const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
  const pdfPath = `clients/${client_id}/week_${week_no}.html`;

  await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
    contentType: 'text/html',
    upsert: true
  });

  const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
  const pdfUrl = urlData.publicUrl;

  await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.weekly_notes || ''
  });

  await sendWhatsApp(client.phone, 'weekly_program', {
    name: client.name,
    templateParams: [client.name, week_no.toString(), pdfUrl],
    media: { url: pdfUrl, filename: `Week_${week_no}_Program.html` }
  });

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ success: true, pdf_url: pdfUrl });
};

function isFlagged(program) {
  const np = program.nutrition_plan;
  if (np && np.calories && np.calories < 1200) return true;
  const supps = (np && np.supplements) || [];
  const banned = ['steroid', 'sarm', 'dnp', 'clenbuterol', 'ephedra'];
  for (const s of supps) {
    if (banned.some(b => s.toLowerCase().includes(b))) return true;
  }
  return false;
}

function renderProgramPDF(client, weekNo, data) {
  const wp = data.workout_plan;
  const np = data.nutrition_plan;

  let workoutHtml = '';
  if (wp && wp.days) {
    for (const day of wp.days) {
      workoutHtml += `<div class="day-block"><h3>${day.day} — ${day.focus}</h3><table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr>`;
      for (const ex of day.exercises || []) {
        workoutHtml += `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest}</td></tr>`;
      }
      workoutHtml += `</table></div>`;
    }
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program - ${client.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#111;color:#fff;padding:40px 24px}
h1,h2,h3{font-family:'Bebas Neue',sans-serif;letter-spacing:1px}
h1{font-size:36px;color:#D4AF7A;margin-bottom:8px}
h2{font-size:24px;color:#D4AF7A;margin:32px 0 16px;border-bottom:1px solid #333;padding-bottom:8px}
h3{font-size:18px;color:#fff;margin-bottom:12px}
.header{text-align:center;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid #D4AF7A}
.subtitle{font-size:14px;color:#999;letter-spacing:2px;text-transform:uppercase}
.day-block{background:#1a1a1a;border-radius:8px;padding:24px;margin-bottom:16px;border-left:3px solid #D4AF7A}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{text-align:left;font-size:11px;color:#D4AF7A;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;border-bottom:1px solid #333}
td{font-size:13px;color:#ddd;padding:8px 12px;border-bottom:1px solid #222}
.nutrition{background:#1a1a1a;border-radius:8px;padding:24px;border-left:3px solid #D4AF7A}
.macro-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
.macro{text-align:center;background:#222;padding:16px 8px;border-radius:6px}
.macro-val{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#D4AF7A}
.macro-label{font-size:10px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
.notes{background:#0d1f0d;border:1px solid #1a3a1a;border-radius:8px;padding:16px;margin-top:24px;font-size:13px;color:#8fbc8f}
.footer{text-align:center;margin-top:40px;padding-top:24px;border-top:1px solid #333;font-size:11px;color:#666}
</style></head><body>
<div class="header">
  <div class="subtitle">Fitness By Maddy</div>
  <h1>Week ${weekNo} Program</h1>
  <div class="subtitle">${client.name} · ${client.program.replace('_', ' ').toUpperCase()}</div>
</div>
<h2>Workout Plan</h2>
${workoutHtml}
${wp && wp.cardio ? `<p style="margin-top:16px;color:#999;font-size:13px"><strong style="color:#D4AF7A">Cardio:</strong> ${wp.cardio}</p>` : ''}
<h2>Nutrition Plan</h2>
<div class="nutrition">
  <div class="macro-grid">
    <div class="macro"><div class="macro-val">${np ? np.calories : '—'}</div><div class="macro-label">Calories</div></div>
    <div class="macro"><div class="macro-val">${np ? np.protein_g : '—'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro"><div class="macro-val">${np ? np.carbs_g : '—'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro"><div class="macro-val">${np ? np.fats_g : '—'}g</div><div class="macro-label">Fats</div></div>
  </div>
  ${np && np.meal_timing ? `<p style="margin-top:12px;font-size:13px;color:#ccc"><strong>Timing:</strong> ${np.meal_timing}</p>` : ''}
  ${np && np.sample_meals ? `<p style="margin-top:8px;font-size:13px;color:#ccc"><strong>Meals:</strong> ${np.sample_meals.join(', ')}</p>` : ''}
  ${np && np.supplements && np.supplements.length ? `<p style="margin-top:8px;font-size:13px;color:#ccc"><strong>Supplements:</strong> ${np.supplements.join(', ')}</p>` : ''}
</div>
${data.weekly_notes ? `<div class="notes"><strong>Coach Notes:</strong> ${data.weekly_notes}</div>` : ''}
<div class="footer">Fitness By Maddy · fitnessbymaddy.com · Generated ${new Date().toLocaleDateString()}</div>
</body></html>`;
}
