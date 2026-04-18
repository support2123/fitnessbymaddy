const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { PROGRAM_NAMES } = require('../lib/helpers');

const RISKY_TERMS = [
  'below 1000 calories', 'under 800 calories', '500 calorie',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme fasting', 'water fast for',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(200).json({ action: 'already_exists', program_id: existingProgram.id });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
    }));

    const prompt = buildPrompt(client, checkinSummary, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;

    const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
    let programData;
    try {
      programData = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program JSON from Claude' });
    }

    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = RISKY_TERMS.some(term => fullText.includes(term));

    if (flagged) {
      const maddyPhone = process.env.MADDY_PHONE;
      if (maddyPhone) {
        await sendWhatsApp(maddyPhone, 'escalation_alert', [
          client.phone.slice(-4),
          `Week ${week_no} program flagged for risky content — needs manual review`,
        ]);
      }

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || null,
        nutrition_plan: programData.nutrition_plan || null,
        notes: 'FLAGGED: Awaiting Maddy review',
        pdf_url: null,
      });

      return res.status(200).json({ action: 'flagged_for_review' });
    }

    const pdfHtml = renderProgramPdf(client, programData, week_no);

    const pdfBlob = new Blob([pdfHtml], { type: 'text/html' });
    const filePath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(filePath, pdfBlob, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan || null,
      nutrition_plan: programData.nutrition_plan || null,
      notes: programData.notes || null,
      pdf_url: pdfUrl,
    }).select().single();

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      programData.notes || `Your Week ${week_no} plan is ready!`,
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  return `You are "Program Architect" for Fitness by Maddy, an elite online coaching brand.

Generate a Week ${weekNo} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Started: ${client.program_started_at}

RECENT CHECK-IN DATA:
${JSON.stringify(checkins, null, 2)}

RULES:
- Warm, expert tone. Never bro-sciency. Never over-promise.
- Realistic calorie targets (never below 1200 for women, 1500 for men).
- No banned substances or extreme protocols.
- If client reported pain/injury, modify exercises accordingly.
- Progressive overload from previous weeks.

Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + band pull-aparts",
        "cooldown": "5 min stretching"
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "weekly_cardio": "3x 20-min LISS or 2x 15-min HIIT"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "example": "4 egg whites + 1 whole egg, oats with banana", "macros": "P:30g C:45g F:10g" }
    ],
    "hydration": "3-4 liters water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D3"]
  },
  "notes": "One-liner context for this week's focus"
}
\`\`\``;
}

function renderProgramPdf(client, data, weekNo) {
  const wp = data.workout_plan || {};
  const np = data.nutrition_plan || {};

  const workoutDays = (wp.days || []).map(day => `
    <div class="day-card">
      <h3>${day.day} — ${day.focus}</h3>
      ${day.warmup ? `<p class="warmup">Warm-up: ${day.warmup}</p>` : ''}
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr>
        ${(day.exercises || []).map(ex => `
          <tr>
            <td>${ex.name}${ex.notes ? ` <small>(${ex.notes})</small>` : ''}</td>
            <td>${ex.sets}</td>
            <td>${ex.reps}</td>
            <td>${ex.rest}</td>
          </tr>
        `).join('')}
      </table>
      ${day.cooldown ? `<p class="cooldown">Cool-down: ${day.cooldown}</p>` : ''}
    </div>
  `).join('');

  const meals = (np.meals || []).map(m => `
    <div class="meal">
      <strong>${m.meal}:</strong> ${m.example} <span class="macros">${m.macros}</span>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #FAF8F4; color: #2C2C2C; padding: 40px; }
  .header { background: #2C2C2C; color: white; padding: 40px; margin: -40px -40px 40px; text-align: center; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; letter-spacing: 4px; color: #B8965A; }
  .header h2 { font-family: 'DM Sans', sans-serif; font-size: 16px; font-weight: 300; color: rgba(255,255,255,0.7); margin-top: 8px; }
  .header .week-badge { display: inline-block; background: #B8965A; color: #2C2C2C; padding: 8px 24px; font-size: 12px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; margin-top: 16px; }
  h2.section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; letter-spacing: 2px; color: #2C2C2C; margin: 32px 0 16px; border-bottom: 2px solid #B8965A; padding-bottom: 8px; }
  .day-card { background: white; padding: 24px; margin-bottom: 16px; border-left: 4px solid #B8965A; }
  .day-card h3 { font-size: 18px; font-weight: 600; margin-bottom: 12px; }
  .warmup, .cooldown { font-size: 13px; color: #6B6B6B; margin: 8px 0; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { background: #2C2C2C; color: white; padding: 10px 16px; text-align: left; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
  td { padding: 10px 16px; border-bottom: 1px solid #E8E3DC; font-size: 14px; }
  .nutrition { background: white; padding: 24px; margin-bottom: 16px; }
  .macro-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0; }
  .macro-box { text-align: center; padding: 16px; background: #F0EAE0; }
  .macro-box .num { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-box .label { font-size: 11px; color: #6B6B6B; text-transform: uppercase; letter-spacing: 1px; }
  .meal { padding: 12px 0; border-bottom: 1px solid #E8E3DC; font-size: 14px; }
  .macros { color: #B8965A; font-size: 12px; font-weight: 500; }
  .footer { text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid #E8E3DC; font-size: 12px; color: #6B6B6B; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>${client.name || 'Your'} Custom Program</h2>
    <div class="week-badge">Week ${weekNo}</div>
  </div>

  <h2 class="section-title">Workout Plan</h2>
  ${workoutDays}
  ${wp.rest_days ? `<p style="margin:16px 0;color:#6B6B6B;">Rest days: ${wp.rest_days.join(', ')}</p>` : ''}
  ${wp.weekly_cardio ? `<p style="margin:8px 0;color:#6B6B6B;">Cardio: ${wp.weekly_cardio}</p>` : ''}

  <h2 class="section-title">Nutrition Plan</h2>
  <div class="nutrition">
    <div class="macro-grid">
      <div class="macro-box"><div class="num">${np.calories || '—'}</div><div class="label">Calories</div></div>
      <div class="macro-box"><div class="num">${np.protein_g || '—'}g</div><div class="label">Protein</div></div>
      <div class="macro-box"><div class="num">${np.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
      <div class="macro-box"><div class="num">${np.fat_g || '—'}g</div><div class="label">Fat</div></div>
    </div>
    ${meals}
    ${np.hydration ? `<p style="margin-top:16px;font-size:13px;color:#6B6B6B;">Hydration: ${np.hydration}</p>` : ''}
    ${np.supplements ? `<p style="margin-top:8px;font-size:13px;color:#6B6B6B;">Supplements: ${np.supplements.join(', ')}</p>` : ''}
  </div>

  ${data.notes ? `<div style="background:#2C2C2C;color:white;padding:24px;margin-top:24px;text-align:center;"><p style="color:#B8965A;font-size:14px;">${data.notes}</p></div>` : ''}

  <div class="footer">
    <p>Fitness by Maddy &middot; fitnessbymaddy.com &middot; @fitnessbymaddy_</p>
  </div>
</body>
</html>`;
}
