const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'sarms', 'steroids',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some((flag) => lower.includes(flag));
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

    let intakeData = null;
    try {
      const { data: fileData } = await supabase.storage
        .from('clients')
        .download(`intake/${client.lead_id}.json`);
      if (fileData) {
        intakeData = JSON.parse(await fileData.text());
      }
    } catch (e) {}

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a program architect for FitnessByMaddy, an elite online fitness coaching brand. You create weekly workout and nutrition plans that are:
- Science-backed and safe
- Personalized to the client's data
- Progressive (building on previous weeks)
- Realistic and sustainable

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [{ "name": "", "sets": 0, "reps": "", "rest": "", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "", "duration": "", "frequency": "" }
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": [""], "macros": "" }
    ],
    "hydration": "",
    "supplements": []
  },
  "weekly_note": ""
}

NEVER recommend extreme calorie restriction (below 1200 for women, 1500 for men), banned substances, or unrealistic timelines.`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Unknown'}
Program: ${client.program}
${intakeData ? `Age: ${intakeData.age}, Gender: ${intakeData.gender}` : ''}
${intakeData ? `Goal: ${intakeData.goal}` : ''}
${intakeData ? `Equipment: ${intakeData.available_equipment}` : ''}
${intakeData ? `Injuries: ${intakeData.injuries || 'None'}` : ''}
${intakeData ? `Diet preference: ${intakeData.diet_preference}` : ''}
${intakeData ? `Schedule: ${intakeData.weekly_schedule}` : ''}

Recent check-ins:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map((c) =>
      `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`
    ).join('\n')
  : 'No previous check-ins available (first week).'
}

Generate the week ${week_no} plan as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    if (hasSafetyIssue(content)) {
      const { sendTemplate: notifyMaddy } = require('./_lib/whatsapp');
      await notifyMaddy('+917082478374', 'escalation_alert', [
        'Unsafe program generated — flagged for review',
        client.phone,
        client.name || 'Unknown',
        `Week ${week_no} program contained safety flags`,
      ]);
      return res.status(200).json({ action: 'flagged_for_review' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const pdfHtml = generatePdfHtml(client, week_no, parsed);
    const pdfPath = `${client_id}/week_${week_no}.html`;

    await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfHtml, {
        contentType: 'text/html',
        upsert: true,
      });

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);

    const { error: progErr } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: urlData.publicUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.weekly_note || null,
    });

    if (progErr) {
      console.error('Program insert error:', progErr.message);
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      parsed.weekly_note || 'Your new week plan is ready!',
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({
      action: 'program_generated',
      week_no,
      pdf_url: urlData.publicUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePdfHtml(client, weekNo, plan) {
  const workoutRows = (plan.workout_plan?.days || [])
    .map((day) => {
      const exercises = (day.exercises || [])
        .map(
          (ex) =>
            `<tr><td>${ex.name}</td><td>${ex.sets} × ${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`
        )
        .join('');
      return `<h3 style="color:#B8965A;margin:24px 0 8px;font-family:'Cormorant Garamond',serif;">${day.day} — ${day.focus}</h3>
        <table><thead><tr><th>Exercise</th><th>Sets × Reps</th><th>Rest</th><th>Notes</th></tr></thead><tbody>${exercises}</tbody></table>`;
    })
    .join('');

  const mealRows = (plan.nutrition_plan?.meals || [])
    .map(
      (m) =>
        `<tr><td style="font-weight:600">${m.meal}</td><td>${(m.options || []).join(', ')}</td><td>${m.macros || ''}</td></tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; background:#FAF8F4; color:#2C2C2C; padding:40px; max-width:800px; margin:0 auto; }
  .header { background:#2C2C2C; color:white; padding:40px; margin:-40px -40px 40px; text-align:center; }
  .header h1 { font-family:'Cormorant Garamond',serif; font-size:36px; font-weight:300; color:#B8965A; }
  .header h2 { font-family:'Cormorant Garamond',serif; font-size:24px; font-weight:300; color:white; margin-top:8px; }
  .header p { color:rgba(255,255,255,0.6); font-size:13px; margin-top:12px; letter-spacing:2px; text-transform:uppercase; }
  h3 { font-size:18px; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; }
  th { background:#2C2C2C; color:#B8965A; text-align:left; padding:10px 12px; font-size:11px; letter-spacing:1.5px; text-transform:uppercase; }
  td { padding:10px 12px; border-bottom:1px solid #E8E3DC; font-size:13px; }
  .section-title { font-family:'Cormorant Garamond',serif; font-size:28px; color:#2C2C2C; margin:40px 0 16px; padding-bottom:12px; border-bottom:2px solid #B8965A; }
  .macros { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin:16px 0 32px; }
  .macro-box { background:white; padding:20px; text-align:center; border:1px solid #E8E3DC; }
  .macro-num { font-family:'Cormorant Garamond',serif; font-size:32px; font-weight:600; color:#B8965A; }
  .macro-label { font-size:11px; color:#6B6B6B; letter-spacing:1px; text-transform:uppercase; margin-top:4px; }
  .note { background:#2C2C2C; color:white; padding:24px; margin-top:40px; border-left:4px solid #B8965A; }
  .note p { font-size:14px; line-height:1.7; color:rgba(255,255,255,0.8); }
  .footer { text-align:center; margin-top:48px; padding-top:24px; border-top:1px solid #E8E3DC; }
  .footer p { font-size:12px; color:#6B6B6B; }
</style>
</head>
<body>
  <div class="header">
    <h1>Fitness by Maddy</h1>
    <h2>Week ${weekNo} Program</h2>
    <p>${client.name || 'Client'} · ${plan.workout_plan?.days?.length || 0}-Day Split</p>
  </div>

  <div class="section-title">Workout Plan</div>
  ${workoutRows}
  ${plan.workout_plan?.cardio ? `<p style="margin:16px 0;color:#6B6B6B;">Cardio: ${plan.workout_plan.cardio.type} — ${plan.workout_plan.cardio.duration}, ${plan.workout_plan.cardio.frequency}</p>` : ''}

  <div class="section-title">Nutrition Plan</div>
  <div class="macros">
    <div class="macro-box"><div class="macro-num">${plan.nutrition_plan?.calories || '-'}</div><div class="macro-label">Calories</div></div>
    <div class="macro-box"><div class="macro-num">${plan.nutrition_plan?.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro-box"><div class="macro-num">${plan.nutrition_plan?.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro-box"><div class="macro-num">${plan.nutrition_plan?.fats_g || '-'}g</div><div class="macro-label">Fats</div></div>
  </div>
  <table><thead><tr><th>Meal</th><th>Options</th><th>Macros</th></tr></thead><tbody>${mealRows}</tbody></table>
  ${plan.nutrition_plan?.hydration ? `<p style="color:#6B6B6B;margin:8px 0;">Hydration: ${plan.nutrition_plan.hydration}</p>` : ''}

  ${plan.weekly_note ? `<div class="note"><p><strong>Coach's Note:</strong> ${plan.weekly_note}</p></div>` : ''}

  <div class="footer"><p>© Fitness by Maddy · fitnessbymaddy.com</p></div>
</body>
</html>`;
}
