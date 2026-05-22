const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'anabolic', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: previousProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, recentCheckins, previousProgram, week_no);

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    const claudeData = await claudeResponse.json();
    const responseText = claudeData.content?.[0]?.text || '';

    const hasSafetyFlag = SAFETY_FLAGS.some(flag =>
      responseText.toLowerCase().includes(flag)
    );

    if (hasSafetyFlag) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation({
        phone: client.phone,
        clientId: client_id,
        reason: 'Program generation flagged for safety review',
        messageBody: `Week ${week_no} program for client contained safety-flagged content. Halted auto-send.`
      });

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: null,
        nutrition_plan: null,
        notes: 'FLAGGED: Awaiting Maddy review due to safety content'
      });

      return res.status(200).json({ success: false, reason: 'safety_flagged' });
    }

    let workoutPlan, nutritionPlan;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout_plan || parsed.workout;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
    }

    const pdfHtml = buildPdfHtml(client, week_no, workoutPlan, nutritionPlan);

    const pdfPath = `clients/${client_id}/week_${week_no}.html`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(pdfPath, pdfHtml, {
        contentType: 'text/html',
        upsert: true
      });

    const { data: publicUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    const pdfUrl = publicUrl?.publicUrl || pdfPath;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: `Auto-generated for week ${week_no}`
    });

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const messageBody = hinglish
      ? `Week ${week_no} ka program ready hai! \u{1F4AA}\n\n\u{1F449} ${pdfUrl}\n\nIs hafte ka focus: Progressive overload + nutrition consistency. Questions ho toh pooch lo!`
      : `Your Week ${week_no} program is ready! \u{1F4AA}\n\n\u{1F449} ${pdfUrl}\n\nThis week's focus: Progressive overload + nutrition consistency. Questions? Just ask!`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [client.name || 'there', String(week_no)],
      body: messageBody
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdfUrl });
  } catch (error) {
    console.error('Program generation error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, checkins, previousProgram, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  const prevPlan = previousProgram?.workout_plan
    ? JSON.stringify(previousProgram.workout_plan)
    : 'No previous program';

  return `You are a certified fitness program architect creating a weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Program: ${client.program} (Week ${weekNo} of ${client.program === '12wk' ? 12 : 6})
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

PREVIOUS WEEK PLAN:
${prevPlan}

INSTRUCTIONS:
1. Create a progressive workout plan for this week (5-6 days)
2. Create a nutrition plan with macros and meal ideas
3. Adjust based on check-in data (compliance, energy, issues)
4. Be specific: sets, reps, rest times, food quantities
5. NEVER recommend extreme calorie deficits below 1200 cal
6. NEVER recommend any banned or dangerous substances
7. Keep timelines realistic and healthy

Return ONLY valid JSON in this format:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min incline walk"
      }
    ],
    "notes": "Progressive overload focus this week"
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": "Focus on protein timing around workouts"
  }
}`;
}

function buildPdfHtml(client, weekNo, workout, nutrition) {
  const workoutDays = workout?.days || [];
  const workoutHtml = workoutDays.map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.day} — ${day.focus}</h3>
        <table>
          <thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
        ${day.cardio ? `<p class="cardio">Cardio: ${day.cardio}</p>` : ''}
      </div>`;
  }).join('');

  const meals = (nutrition?.meals || []).map(m =>
    `<div class="meal"><h4>${m.meal}</h4><ul>${(m.options || []).map(o => `<li>${o}</li>`).join('')}</ul></div>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #0a0a0a; color: #fff; padding: 40px 24px; }
  .header { text-align: center; border-bottom: 2px solid #B8965A; padding-bottom: 24px; margin-bottom: 32px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; letter-spacing: 3px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #fff; letter-spacing: 2px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; }
  .day-block { background: #151515; border: 1px solid #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #B8965A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; padding: 8px; border-bottom: 1px solid #333; }
  td { font-size: 14px; padding: 8px; border-bottom: 1px solid #1a1a1a; color: #ddd; }
  .cardio { margin-top: 12px; font-size: 13px; color: #B8965A; }
  .macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .macro-box { background: #151515; border: 1px solid #B8965A; border-radius: 8px; padding: 16px; text-align: center; }
  .macro-box .val { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; }
  .macro-box .lbl { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .meal { background: #151515; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .meal h4 { font-family: 'Bebas Neue', sans-serif; color: #B8965A; margin-bottom: 8px; }
  .meal li { font-size: 14px; color: #ddd; padding: 4px 0; margin-left: 16px; }
  .footer { text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid #222; color: #555; font-size: 12px; }
  @media (max-width: 600px) { .macros { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name || 'Client'} &middot; ${client.program?.toUpperCase().replace('_', ' ')} &middot; ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${workoutHtml || '<p style="color:#888">No workout data available</p>'}
  ${workout?.notes ? `<p style="margin-top:16px;color:#B8965A;font-size:14px">${workout.notes}</p>` : ''}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="macros">
    <div class="macro-box"><div class="val">${nutrition?.calories || '—'}</div><div class="lbl">Calories</div></div>
    <div class="macro-box"><div class="val">${nutrition?.protein_g || '—'}g</div><div class="lbl">Protein</div></div>
    <div class="macro-box"><div class="val">${nutrition?.carbs_g || '—'}g</div><div class="lbl">Carbs</div></div>
    <div class="macro-box"><div class="val">${nutrition?.fat_g || '—'}g</div><div class="lbl">Fat</div></div>
  </div>
  ${meals || '<p style="color:#888">No meal plan data available</p>'}
  ${nutrition?.supplements ? `<p style="margin-top:16px;color:#ddd;font-size:13px"><strong style="color:#B8965A">Supplements:</strong> ${nutrition.supplements.join(', ')}</p>` : ''}
  ${nutrition?.notes ? `<p style="margin-top:8px;color:#888;font-size:13px">${nutrition.notes}</p>` : ''}

  <div class="footer">
    FITNESS BY MADDY &middot; fitnessbymaddy.com &middot; @fitnessbymaddy_
  </div>
</body>
</html>`;
}
