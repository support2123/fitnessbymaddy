const { getSupabase } = require('./lib/supabase');
const { sendMediaMessage } = require('./lib/whatsapp');
const { isHinglish, detectMarket } = require('./lib/market');
const { escalateToMaddy } = require('./lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'anabolic',
  'lose 10kg in a week', 'lose 20 pounds in a week',
  'starvation', 'water fast for',
];

function checkProgramSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create weekly personalized workout and nutrition plans.

RULES:
- Plans must be safe, evidence-based, and appropriate for the client's level
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines
- Adapt based on check-in data (compliance, energy, weight trends)
- Include warm-up and cool-down in workouts
- Account for any injuries or medical conditions mentioned

OUTPUT FORMAT: Return valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..."}] }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": ["..."],
    "sample_meals": { "breakfast": "...", "lunch": "...", "dinner": "...", "snacks": "..." },
    "hydration": "...",
    "supplements": ["..."]
  },
  "weekly_note": "Short motivational + strategic note for the client"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No check-in data yet (first week).'}

${prevProgram ? `PREVIOUS WEEK PLAN SUMMARY:
Workout: ${JSON.stringify(prevProgram.workout_plan).slice(0, 500)}
Nutrition: ${JSON.stringify(prevProgram.nutrition_plan).slice(0, 500)}` : 'No previous plan (first week).'}

Create an appropriate progressive program for Week ${week_no}. Adjust intensity based on compliance and energy levels.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    if (checkProgramSafety(responseText)) {
      await escalateToMaddy('Program generation flagged for safety review', {
        phone: client.phone,
        details: `Week ${week_no} program contained safety flags. Halted auto-send.`,
      });
      return res.json({ action: 'flagged_for_review', client_id, week_no });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const pdfHtml = generatePdfHtml(client, week_no, parsed);

    const pdfFileName = `week_${week_no}.html`;
    const storagePath = `${client.folder_url || 'clients/' + client_id}/${pdfFileName}`;

    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(storagePath, Buffer.from(pdfHtml), {
        contentType: 'text/html',
        upsert: true,
      });

    let pdfUrl = null;
    if (!uploadError) {
      const { data: urlData } = db.storage.from('programs').getPublicUrl(storagePath);
      pdfUrl = urlData?.publicUrl;
    }

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.weekly_note,
    });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    if (pdfUrl) {
      const market = detectMarket(client.phone);
      const caption = isHinglish(market)
        ? `Week ${week_no} ka program ready hai! ${parsed.weekly_note || ''}`
        : `Your Week ${week_no} program is ready! ${parsed.weekly_note || ''}`;

      await sendMediaMessage(client.phone, pdfUrl, caption);

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('client_id', client_id).eq('week_no', parseInt(week_no));
    }

    return res.json({ success: true, client_id, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePdfHtml(client, weekNo, plan) {
  const exercises = (plan.workout_plan?.days || []).map(day => `
    <div style="margin-bottom:24px;">
      <h3 style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:#B8965A;margin-bottom:8px;">${day.day} — ${day.focus}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#2C2C2C;color:white;">
          <th style="padding:8px;text-align:left;">Exercise</th>
          <th style="padding:8px;text-align:center;">Sets</th>
          <th style="padding:8px;text-align:center;">Reps</th>
          <th style="padding:8px;text-align:center;">Rest</th>
        </tr>
        ${(day.exercises || []).map((ex, i) => `
        <tr style="background:${i % 2 === 0 ? '#FAF8F4' : '#F0EAE0'};">
          <td style="padding:8px;">${ex.name}${ex.notes ? ' <small style="color:#6B6B6B;">(' + ex.notes + ')</small>' : ''}</td>
          <td style="padding:8px;text-align:center;">${ex.sets}</td>
          <td style="padding:8px;text-align:center;">${ex.reps}</td>
          <td style="padding:8px;text-align:center;">${ex.rest}</td>
        </tr>`).join('')}
      </table>
    </div>`).join('');

  const nutrition = plan.nutrition_plan || {};

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  body{font-family:'DM Sans',sans-serif;background:#FAF8F4;color:#2C2C2C;margin:0;padding:0;}
  .container{max-width:800px;margin:0 auto;padding:40px 32px;}
  .header{background:#2C2C2C;color:white;padding:40px 32px;text-align:center;}
  .header h1{font-family:'Bebas Neue',sans-serif;font-size:36px;letter-spacing:4px;margin:0;color:#B8965A;}
  .header p{font-size:14px;color:rgba(255,255,255,0.6);margin-top:8px;}
  .section-title{font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:2px;color:#2C2C2C;border-bottom:2px solid #B8965A;padding-bottom:8px;margin:32px 0 16px;}
  .macro-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0;}
  .macro-box{background:#2C2C2C;color:white;padding:16px;text-align:center;border-radius:4px;}
  .macro-box .num{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#B8965A;}
  .macro-box .label{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.6);}
  .note{background:#F0EAE0;padding:20px;border-left:4px solid #B8965A;margin:24px 0;font-style:italic;color:#6B6B6B;}
  .footer{text-align:center;padding:24px;font-size:12px;color:#6B6B6B;}
</style>
</head>
<body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <p>Week ${weekNo} Program — ${client.name || 'Client'}</p>
</div>
<div class="container">
  ${plan.weekly_note ? `<div class="note">${plan.weekly_note}</div>` : ''}
  <div class="section-title">WORKOUT PLAN</div>
  ${exercises}
  ${plan.workout_plan?.cardio ? `<p style="margin-top:16px;"><strong>Cardio:</strong> ${plan.workout_plan.cardio.type} — ${plan.workout_plan.cardio.frequency}, ${plan.workout_plan.cardio.duration}</p>` : ''}
  <div class="section-title">NUTRITION PLAN</div>
  <div class="macro-grid">
    <div class="macro-box"><div class="num">${nutrition.calories || '—'}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="num">${nutrition.protein_g || '—'}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="num">${nutrition.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="num">${nutrition.fat_g || '—'}g</div><div class="label">Fat</div></div>
  </div>
  ${nutrition.sample_meals ? `
  <h3 style="margin-top:24px;font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#6B6B6B;">Sample Meals</h3>
  <ul style="list-style:none;padding:0;">
    ${Object.entries(nutrition.sample_meals).map(([meal, desc]) => `<li style="padding:8px 0;border-bottom:1px solid #E8E3DC;"><strong style="text-transform:capitalize;">${meal}:</strong> ${desc}</li>`).join('')}
  </ul>` : ''}
  ${nutrition.hydration ? `<p style="margin-top:16px;"><strong>Hydration:</strong> ${nutrition.hydration}</p>` : ''}
  <div class="footer">
    <p>Fitness by Maddy &bull; fitnessbymaddy.com</p>
    <p style="color:#B8965A;">Keep pushing. Results are earned, not given.</p>
  </div>
</div>
</body>
</html>`;
}
