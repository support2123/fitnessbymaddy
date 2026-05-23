const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /extreme\s*(cut|deficit|fast)/i,
  /clenbuterol|dnp|ephedrine|sarm/i,
  /lose\s*\d{2,}\s*(kg|lb|pound)\s*in\s*(1|2)\s*week/i,
  /starvation|starve/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeFile } = await db.storage
      .from('clients')
      .download(`intake/${client.lead_id}.json`);

    let intakeData = {};
    if (intakeFile) {
      try {
        const text = await intakeFile.text();
        intakeData = JSON.parse(text);
      } catch (e) { /* no intake data */ }
    }

    const prompt = buildPrompt(client, intakeData, recentCheckins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const rawOutput = claudeData.content[0].text;

    if (isRisky(rawOutput)) {
      const { notifyMaddy } = require('../lib/whatsapp');
      await notifyMaddy(
        'Risky program content flagged',
        `Client: ${client.name || client.phone}\nWeek: ${week_no}\nContent needs review before sending.`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: { flagged: true, raw: rawOutput },
        nutrition_plan: {},
        notes: 'FLAGGED: Needs Maddy review before sending'
      });

      return res.status(200).json({ ok: true, flagged: true });
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : rawOutput);
    } catch (e) {
      parsed = { workout_plan: rawOutput, nutrition_plan: '' };
    }

    const pdfHtml = renderProgramPdf(client, parsed, week_no);
    const pdfPath = `${client_id}/week_${week_no}.html`;

    await db.storage.from('clients').upload(pdfPath, pdfHtml, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData.publicUrl,
      workout_plan: parsed.workout || parsed.workout_plan || {},
      nutrition_plan: parsed.nutrition || parsed.nutrition_plan || {},
      notes: parsed.notes || null,
      whatsapp_sent_at: new Date().toISOString()
    });

    if (insertErr) throw insertErr;

    const contextNote = parsed.notes || `Week ${week_no} program is ready!`;
    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [String(week_no), contextNote],
      media: { url: urlData.publicUrl }
    });

    return res.status(200).json({ ok: true, week_no, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are an expert fitness coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Injuries/conditions: ${intake.injuries || 'None reported'}
- Diet preference: ${intake.diet_preference || 'No preference'}
- Equipment: ${intake.equipment_access || 'Full gym'}
- Workout days available: ${intake.workout_days || '5'}
- Current weight: ${intake.current_weight || 'Unknown'}
- Target weight: ${intake.target_weight || 'Unknown'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins'}

RULES:
- Create a safe, progressive program
- Never recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances or supplements
- Never promise unrealistic timelines
- Adjust based on compliance and energy scores
- Be mindful of any injuries or medical conditions

OUTPUT FORMAT (JSON):
\`\`\`json
{
  "workout": {
    "days": [
      {
        "day": "Day 1 - Upper Body",
        "exercises": [
          {"name": "Exercise name", "sets": 3, "reps": "10-12", "rest": "60s", "notes": ""}
        ]
      }
    ],
    "cardio": "description",
    "rest_days": "description"
  },
  "nutrition": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meal_plan": [
      {"meal": "Breakfast", "options": ["option 1", "option 2"]},
      {"meal": "Lunch", "options": ["option 1", "option 2"]},
      {"meal": "Dinner", "options": ["option 1", "option 2"]},
      {"meal": "Snacks", "options": ["option 1", "option 2"]}
    ],
    "hydration": "recommendation",
    "supplements": "safe recommendations only"
  },
  "notes": "One-line context note for WhatsApp message"
}
\`\`\``;
}

function isRisky(text) {
  return RISKY_PATTERNS.some(pattern => pattern.test(text));
}

function renderProgramPdf(client, program, weekNo) {
  const workout = program.workout || program.workout_plan || {};
  const nutrition = program.nutrition || program.nutrition_plan || {};

  const workoutDays = (workout.days || []).map(day => `
    <div class="day-block">
      <h3>${day.day || 'Workout Day'}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>
        ${(day.exercises || []).map(ex => `
          <tr>
            <td>${ex.name}</td>
            <td>${ex.sets}</td>
            <td>${ex.reps}</td>
            <td>${ex.rest || '-'}</td>
            <td>${ex.notes || '-'}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `).join('');

  const meals = (nutrition.meal_plan || []).map(m => `
    <div class="meal-block">
      <h4>${m.meal}</h4>
      <ul>${(m.options || []).map(o => `<li>${o}</li>`).join('')}</ul>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Week ${weekNo} Program - ${client.name || 'Client'}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
    .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
    .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
    .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
    .header p { color: #999; font-size: 14px; margin-top: 8px; }
    .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 3px; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 1px solid #333; }
    .day-block { margin-bottom: 24px; }
    .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #D4AF7A; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #2a2a2a; color: #B8965A; text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
    td { padding: 10px 12px; border-bottom: 1px solid #333; font-size: 14px; color: #ccc; }
    .macros { display: flex; gap: 24px; margin: 16px 0; flex-wrap: wrap; }
    .macro-box { background: #2a2a2a; padding: 16px 24px; border-radius: 4px; text-align: center; flex: 1; min-width: 100px; }
    .macro-box .num { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
    .macro-box .label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .meal-block { margin-bottom: 16px; }
    .meal-block h4 { color: #D4AF7A; font-size: 16px; margin-bottom: 8px; }
    .meal-block ul { list-style: none; }
    .meal-block li { padding: 4px 0; color: #ccc; font-size: 14px; }
    .meal-block li::before { content: '→ '; color: #B8965A; }
    .footer { text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid #333; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name || 'Client'} | ${client.program.toUpperCase().replace('_', ' ')}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${workoutDays}
  ${workout.cardio ? `<p style="color:#ccc; margin: 16px 0;"><strong style="color:#D4AF7A;">Cardio:</strong> ${workout.cardio}</p>` : ''}
  ${workout.rest_days ? `<p style="color:#ccc;"><strong style="color:#D4AF7A;">Rest Days:</strong> ${workout.rest_days}</p>` : ''}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="macros">
    <div class="macro-box"><div class="num">${nutrition.calories || '-'}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="num">${nutrition.protein_g || '-'}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="num">${nutrition.carbs_g || '-'}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="num">${nutrition.fat_g || '-'}g</div><div class="label">Fat</div></div>
  </div>
  ${meals}
  ${nutrition.hydration ? `<p style="color:#ccc; margin: 16px 0;"><strong style="color:#D4AF7A;">Hydration:</strong> ${nutrition.hydration}</p>` : ''}
  ${nutrition.supplements ? `<p style="color:#ccc;"><strong style="color:#D4AF7A;">Supplements:</strong> ${nutrition.supplements}</p>` : ''}

  <div class="footer">
    <p>FITNESS BY MADDY | fitnessbymaddy.com</p>
    <p style="margin-top:4px;">This program is personalised for ${client.name || 'you'}. Do not share.</p>
  </div>
</body>
</html>`;
}
