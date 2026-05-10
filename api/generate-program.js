const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendText } = require('./lib/whatsapp');
const { detectMarket } = require('./lib/market');
const { escalateToMaddy } = require('./lib/escalation');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Get client profile
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get intake data if available
    let intakeData = null;
    try {
      const { data: intakeFile } = await supabase.storage
        .from('client-data')
        .download(`intakes/${client.lead_id}.json`);
      if (intakeFile) {
        intakeData = JSON.parse(await intakeFile.text());
      }
    } catch (e) { /* no intake form — fine */ }

    // Build prompt
    const prompt = buildProgramPrompt(client, recentCheckins, intakeData, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    // Parse JSON from response
    let programData;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      programData = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    // Safety check
    const safetyIssue = checkProgramSafety(programData);
    if (safetyIssue) {
      await escalateToMaddy('Program safety flag', client.phone, safetyIssue);
      return res.status(200).json({ flagged: true, reason: safetyIssue });
    }

    // Generate PDF (HTML-to-text branded format for now)
    const pdfContent = renderProgramHtml(programData, client, week_no);
    const pdfPath = `clients/${client_id}/week_${week_no}_program.html`;
    await supabase.storage.from('client-data').upload(pdfPath, pdfContent, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = supabase.storage.from('client-data').getPublicUrl(pdfPath);

    // Store in programs table
    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData.publicUrl,
      workout_plan: programData.workout_plan || programData.workout,
      nutrition_plan: programData.nutrition_plan || programData.nutrition,
      notes: programData.coach_note || null
    }).select().single();

    // Send via WhatsApp
    const market = detectMarket(client.phone);
    const note = programData.coach_note || `Week ${week_no} program ready!`;

    if (market === 'IN') {
      await sendText(client.phone,
        `💪 Week ${week_no} ka program ready hai!\n\n` +
        `${note}\n\n` +
        `Yahan dekho: ${urlData.publicUrl}`
      );
    } else {
      await sendText(client.phone,
        `💪 Your Week ${week_no} program is ready!\n\n` +
        `${note}\n\n` +
        `View it here: ${urlData.publicUrl}`
      );
    }

    // Update sent timestamp
    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, intake, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, ` +
    `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, ` +
    `Issues: ${c.issues || 'none'}`
  ).join('\n');

  const intakeSummary = intake ?
    `Goal: ${intake.goal}, Age: ${intake.age}, Injuries: ${intake.injuries || 'none'}, ` +
    `Diet: ${intake.diet_preference || 'flexible'}, Schedule: ${intake.schedule || 'flexible'}` :
    'No intake form data available';

  return `You are a program architect for FitnessByMaddy, an elite online coaching service.

Generate Week ${weekNo} workout and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- ${intakeSummary}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins'}

RULES:
- Never prescribe extreme calorie cuts (below 1200 cal for women, 1500 for men)
- Never recommend banned/dangerous substances
- Never promise specific weight loss timelines
- Be progressive — increase volume/intensity gradually
- Account for any injuries or issues mentioned
- Include rest days and deload guidance if needed

Respond with ONLY a JSON object in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "...",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meal_timing": "...",
    "sample_meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "coach_note": "One-liner motivational/context note for the client"
}
\`\`\``;
}

function checkProgramSafety(programData) {
  const nutrition = programData.nutrition_plan || programData.nutrition || {};
  const calories = nutrition.calories || nutrition.total_calories;

  if (calories && calories < 1200) {
    return `Calorie target too low: ${calories}cal. Minimum is 1200.`;
  }

  const supplements = (nutrition.supplements || []).join(' ').toLowerCase();
  const banned = ['steroid', 'sarm', 'dnp', 'clenbuterol', 'ephedra', 'hgh'];
  for (const substance of banned) {
    if (supplements.includes(substance)) {
      return `Banned substance detected: ${substance}`;
    }
  }

  return null;
}

function renderProgramHtml(programData, client, weekNo) {
  const workout = programData.workout_plan || programData.workout || {};
  const nutrition = programData.nutrition_plan || programData.nutrition || {};
  const days = workout.days || [];

  let workoutHtml = days.map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name}</td>
        <td>${ex.sets} × ${ex.reps}</td>
        <td>${ex.rest || '-'}</td>
        <td>${ex.notes || ''}</td>
      </tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.day} — ${day.focus}</h3>
        <table>
          <thead><tr><th>Exercise</th><th>Sets × Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
      </div>`;
  }).join('');

  const meals = (nutrition.sample_meals || []).map(m =>
    `<div class="meal"><strong>${m.meal}:</strong> ${(m.options || []).join(' / ')}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #FAF8F4; padding: 24px; }
  .container { max-width: 700px; margin: 0 auto; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 32px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #FAF8F4; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #999; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; border-bottom: 1px solid #333; padding-bottom: 8px; }
  .day-block { background: #222; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #D4AF7A; margin-bottom: 12px; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; color: #999; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 4px; border-bottom: 1px solid #333; }
  td { padding: 10px 4px; border-bottom: 1px solid #2a2a2a; color: #ddd; }
  .macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .macro-card { background: #222; border-radius: 8px; padding: 20px; text-align: center; }
  .macro-card .num { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-card .label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .meal { background: #222; padding: 16px; border-radius: 8px; margin-bottom: 8px; font-size: 14px; line-height: 1.6; }
  .meal strong { color: #D4AF7A; }
  .coach-note { background: linear-gradient(135deg, #2a2a1a, #1a1a1a); border: 1px solid #B8965A; border-radius: 8px; padding: 24px; margin-top: 32px; text-align: center; font-style: italic; color: #D4AF7A; font-size: 16px; }
  .footer { text-align: center; padding: 40px 0; color: #555; font-size: 12px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Fitness by Maddy</h1>
    <h2>Week ${weekNo} Program</h2>
    <p>${client.name || 'Client'} · ${client.program.replace(/_/g, ' ').toUpperCase()}</p>
  </div>

  <div class="section-title">Workout Plan</div>
  ${workoutHtml}
  ${workout.cardio ? `<div class="day-block"><h3>Cardio</h3><p>${workout.cardio}</p></div>` : ''}

  <div class="section-title">Nutrition Plan</div>
  <div class="macros">
    <div class="macro-card"><div class="num">${nutrition.calories || '-'}</div><div class="label">Calories</div></div>
    <div class="macro-card"><div class="num">${nutrition.protein_g || '-'}g</div><div class="label">Protein</div></div>
    <div class="macro-card"><div class="num">${nutrition.carbs_g || '-'}g</div><div class="label">Carbs</div></div>
    <div class="macro-card"><div class="num">${nutrition.fat_g || '-'}g</div><div class="label">Fat</div></div>
  </div>
  ${meals}

  ${programData.coach_note ? `<div class="coach-note">"${programData.coach_note}"</div>` : ''}

  <div class="footer">© Fitness by Maddy · fitnessbymaddy.com</div>
</div>
</body>
</html>`;
}
