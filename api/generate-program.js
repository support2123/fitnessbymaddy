const Anthropic = require('anthropic');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedrine', 'steroids', 'sarms',
  'lose 10kg in 1 week', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: lead } = await supabase
      .from('leads')
      .select('intake_data')
      .eq('id', client.lead_id)
      .single();

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      intake: lead?.intake_data || {},
      recent_checkins: checkins || []
    };

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: `You are a certified fitness program architect for FitnessByMaddy.
Generate a personalized weekly training and nutrition plan based on client data.
Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [{"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""}]}],
    "cardio": {"type": "...", "duration": "...", "frequency": "..."}
  },
  "nutrition_plan": {
    "calories": 0, "protein_g": 0, "carbs_g": 0, "fats_g": 0,
    "meal_plan": [{"meal": "Breakfast", "time": "8:00 AM", "options": ["..."]}],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coach note for the week"
}
Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances
- Base progression on check-in data (compliance, weight trend, energy)
- If compliance < 5/10, simplify the plan
- If energy < 4/10, reduce volume by 20%
- Be culturally aware (Indian diet options for IN market clients)`,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n${JSON.stringify(clientProfile, null, 2)}`
      }]
    });

    const responseText = message.content[0].text;

    for (const flag of SAFETY_FLAGS) {
      if (responseText.toLowerCase().includes(flag)) {
        await supabase.from('programs').insert({
          client_id,
          week_no,
          generated_at: new Date().toISOString(),
          workout_plan: { error: 'SAFETY_FLAG', flag },
          nutrition_plan: { error: 'SAFETY_FLAG' },
          notes: `Halted: safety flag "${flag}" detected`
        });
        return res.status(200).json({ halted: true, reason: `Safety flag: ${flag}` });
      }
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const pdfContent = generatePDFHTML(client, week_no, programData);
    const pdfFileName = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage
      .from('client-files')
      .upload(pdfFileName, Buffer.from(pdfContent), {
        contentType: 'text/html',
        upsert: true
      });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfFileName);

    const { error: insertErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: urlData.publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    });

    if (insertErr) throw insertErr;

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name,
      templateParams: [client.name, `Week ${week_no}`, urlData.publicUrl],
      media: { url: urlData.publicUrl, filename: `Week_${week_no}_Program.html` }
    });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDFHTML(client, weekNo, data) {
  const { workout_plan, nutrition_plan, notes } = data;
  const workoutRows = (workout_plan.days || []).map(day => `
    <div class="day-card">
      <h3>${day.day} — ${day.focus}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr>
        ${(day.exercises || []).map(ex => `
          <tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest}</td></tr>
        `).join('')}
      </table>
    </div>
  `).join('');

  const mealRows = (nutrition_plan.meal_plan || []).map(m => `
    <div class="meal-card">
      <strong>${m.meal} (${m.time})</strong>
      <ul>${(m.options || []).map(o => `<li>${o}</li>`).join('')}</ul>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program — ${client.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#fff;padding:40px 20px}
.container{max-width:800px;margin:0 auto}
h1{font-family:'Bebas Neue',sans-serif;font-size:48px;color:#D4AF7A;letter-spacing:2px}
h2{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#D4AF7A;margin:30px 0 15px;letter-spacing:1px}
h3{font-size:18px;color:#D4AF7A;margin-bottom:10px}
.header{text-align:center;padding:30px 0;border-bottom:2px solid #D4AF7A;margin-bottom:30px}
.header p{color:#999;font-size:14px;margin-top:8px}
.day-card{background:#222;border-radius:8px;padding:20px;margin-bottom:15px;border-left:3px solid #D4AF7A}
table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #333}
th{color:#D4AF7A;font-size:12px;text-transform:uppercase;letter-spacing:1px}
.meal-card{background:#222;border-radius:8px;padding:15px;margin-bottom:10px}
.meal-card ul{margin-top:8px;padding-left:20px}
.meal-card li{margin:4px 0;color:#ccc}
.macros{display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin:20px 0}
.macro-box{background:#222;padding:15px;border-radius:8px;text-align:center}
.macro-box .num{font-size:28px;font-weight:600;color:#D4AF7A}
.macro-box .label{font-size:11px;text-transform:uppercase;color:#999;margin-top:4px}
.notes{background:#2a2a1a;border:1px solid #D4AF7A;border-radius:8px;padding:20px;margin-top:30px}
.footer{text-align:center;margin-top:40px;padding-top:20px;border-top:1px solid #333;color:#666;font-size:12px}
</style></head><body>
<div class="container">
  <div class="header">
    <h1>WEEK ${weekNo} PROGRAM</h1>
    <p>${client.name} — Fitness by Maddy</p>
  </div>
  <h2>WORKOUT PLAN</h2>
  ${workoutRows}
  ${workout_plan.cardio ? `<div class="day-card"><h3>Cardio</h3><p>${workout_plan.cardio.type} — ${workout_plan.cardio.duration}, ${workout_plan.cardio.frequency}</p></div>` : ''}
  <h2>NUTRITION PLAN</h2>
  <div class="macros">
    <div class="macro-box"><div class="num">${nutrition_plan.calories}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="num">${nutrition_plan.protein_g}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="num">${nutrition_plan.carbs_g}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="num">${nutrition_plan.fats_g}g</div><div class="label">Fats</div></div>
  </div>
  ${mealRows}
  ${notes ? `<div class="notes"><strong>Coach's Note:</strong> ${notes}</div>` : ''}
  <div class="footer">Generated by Fitness by Maddy Coaching System<br>For personal use only.</div>
</div></body></html>`;
}
