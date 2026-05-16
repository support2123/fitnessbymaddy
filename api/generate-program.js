const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

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

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1);

    const clientProfile = intake?.[0] || {};

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildProgramPrompt(client, clientProfile, checkins || [], week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let programData;

    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program response' });
    }

    if (isProgramUnsafe(programData)) {
      const { escalateToMaddy } = require('./lib/escalate');
      await escalateToMaddy('Unsafe program generated — review needed', {
        name: client.name,
        phone: client.phone,
        details: `Week ${week_no} program flagged for safety review`
      });
      return res.status(200).json({ status: 'flagged_for_review' });
    }

    const pdfHtml = renderProgramPdf(programData, client, week_no);
    const pdfFileName = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage.from('client-files').upload(
      pdfFileName, Buffer.from(pdfHtml), { contentType: 'text/html', upsert: true }
    );

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfFileName);

    const pdfUrl = urlData?.publicUrl || '';

    await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || programData.workouts || {},
      nutrition_plan: programData.nutrition_plan || programData.nutrition || {},
      notes: programData.notes || null
    });

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Week ${week_no}`,
        programData.notes || 'New program ready!'
      ],
      media: { url: pdfUrl, filename: `week_${week_no}_program.html` }
    }, true);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, profile, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a program architect for FitnessByMaddy, an elite online coaching brand.

Generate a Week ${weekNo} training and nutrition program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${profile.goal || 'fat loss and muscle building'}
- Age: ${profile.age || 'not specified'}
- Gender: ${profile.gender || 'not specified'}
- Equipment: ${profile.equipment_access || 'full gym'}
- Workout days: ${profile.workout_days || 5}
- Diet preference: ${profile.diet_preference || 'no restrictions'}
- Injuries: ${profile.injuries || 'none reported'}
- Medical conditions: ${profile.medical_conditions || 'none'}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'not reported'}
- Waist: ${lastCheckin.waist || 'not reported'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'none'}` : 'No previous check-in data available.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

RULES:
- Progressive overload from previous week
- If compliance < 6, simplify the plan
- If energy < 5, reduce volume by 20%
- Never prescribe below 1200 kcal for women or 1500 kcal for men
- Never recommend banned substances or extreme protocols
- Include warm-up and cool-down
- Nutrition should have clear macros and meal timing

Respond ONLY with valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [{"name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}] },
      ...
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 70,
    "meals": [
      { "time": "7:00 AM", "meal": "Breakfast", "options": ["..."] },
      ...
    ],
    "supplements": ["..."]
  },
  "notes": "One-liner context about this week's focus"
}
\`\`\``;
}

function isProgramUnsafe(data) {
  if (!data) return true;
  const nutrition = data.nutrition_plan || data.nutrition || {};
  const calories = nutrition.calories || nutrition.kcal || 0;
  if (calories > 0 && calories < 1100) return true;
  const notes = JSON.stringify(data).toLowerCase();
  const bannedTerms = ['dnp', 'clenbuterol', 'steroids', 'ephedra', 'sibutramine', 'crash diet'];
  return bannedTerms.some(term => notes.includes(term));
}

function renderProgramPdf(data, client, weekNo) {
  const workouts = data.workout_plan?.days || [];
  const nutrition = data.nutrition_plan || {};

  const workoutRows = workouts.map(day => `
    <div class="day-block">
      <h3>${day.day} — ${day.focus}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr>
        ${(day.exercises || []).map(ex => `
          <tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest}</td></tr>
        `).join('')}
      </table>
    </div>
  `).join('');

  const mealRows = (nutrition.meals || []).map(m => `
    <div class="meal-block">
      <strong>${m.time} — ${m.meal}</strong>
      <ul>${(m.options || []).map(o => `<li>${o}</li>`).join('')}</ul>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'DM Sans',sans-serif; background:#1a1a1a; color:#fff; padding:40px 24px; }
.header { text-align:center; margin-bottom:40px; border-bottom:2px solid #B8965A; padding-bottom:24px; }
.header h1 { font-family:'Bebas Neue',sans-serif; font-size:42px; color:#B8965A; letter-spacing:3px; }
.header h2 { font-family:'Bebas Neue',sans-serif; font-size:24px; color:#fff; opacity:0.8; }
.header p { color:#888; font-size:13px; margin-top:8px; }
.section-title { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#B8965A; margin:32px 0 16px; letter-spacing:2px; }
.day-block { background:#2c2c2c; border-radius:8px; padding:20px; margin-bottom:16px; }
.day-block h3 { font-family:'Bebas Neue',sans-serif; font-size:20px; color:#D4AF7A; margin-bottom:12px; }
table { width:100%; border-collapse:collapse; }
th { text-align:left; color:#B8965A; font-size:11px; text-transform:uppercase; letter-spacing:1px; padding:8px 4px; border-bottom:1px solid #444; }
td { padding:8px 4px; font-size:14px; border-bottom:1px solid #333; }
.nutrition-box { background:#2c2c2c; border-radius:8px; padding:24px; margin-bottom:16px; }
.macros { display:flex; gap:24px; flex-wrap:wrap; margin-bottom:20px; }
.macro { text-align:center; }
.macro .num { font-family:'Bebas Neue',sans-serif; font-size:36px; color:#B8965A; }
.macro .label { font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; }
.meal-block { padding:12px 0; border-bottom:1px solid #333; }
.meal-block:last-child { border-bottom:none; }
.meal-block strong { color:#D4AF7A; font-size:14px; }
.meal-block ul { margin-top:6px; padding-left:20px; }
.meal-block li { font-size:13px; color:#ccc; margin:4px 0; }
.footer { text-align:center; margin-top:40px; padding-top:20px; border-top:1px solid #333; color:#666; font-size:12px; }
</style>
</head>
<body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <h2>Week ${weekNo} Program</h2>
  <p>${client.name || 'Client'} · ${client.program?.toUpperCase() || 'CUSTOM'}</p>
</div>

<div class="section-title">WORKOUT PLAN</div>
${workoutRows}

${data.workout_plan?.cardio ? `
<div class="day-block">
  <h3>Cardio</h3>
  <p>${data.workout_plan.cardio.type || 'LISS'} · ${data.workout_plan.cardio.frequency || '3x/week'} · ${data.workout_plan.cardio.duration || '20-30min'}</p>
</div>` : ''}

<div class="section-title">NUTRITION PLAN</div>
<div class="nutrition-box">
  <div class="macros">
    <div class="macro"><div class="num">${nutrition.calories || '—'}</div><div class="label">Calories</div></div>
    <div class="macro"><div class="num">${nutrition.protein_g || '—'}g</div><div class="label">Protein</div></div>
    <div class="macro"><div class="num">${nutrition.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
    <div class="macro"><div class="num">${nutrition.fats_g || '—'}g</div><div class="label">Fats</div></div>
  </div>
  ${mealRows}
</div>

${data.notes ? `<div class="day-block"><strong style="color:#B8965A">Coach's Note:</strong> <span style="color:#ccc">${data.notes}</span></div>` : ''}

<div class="footer">
  <p>© Fitness by Maddy · fitnessbymaddy.com</p>
  <p style="margin-top:4px">This program is personalised for you. Do not share.</p>
</div>
</body>
</html>`;
}
