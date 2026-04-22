const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'crash diet', 'water fast',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const prompt = buildPrompt(client, recentCheckins, prevPrograms, week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const rawOutput = claudeData.content?.[0]?.text || '';

    const lowerOutput = rawOutput.toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => lowerOutput.includes(flag));

    if (flagged) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: 'Program generation flagged for safety review',
        phone: client.phone,
        context: `Week ${week_no} program contains risky content. Manual review needed.`,
      });
      return res.json({ action: 'flagged_for_review', week_no });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        workoutPlan = parsed.workout_plan || parsed.workouts || null;
        nutritionPlan = parsed.nutrition_plan || parsed.nutrition || null;
        notes = parsed.notes || parsed.coach_notes || '';
      }
    } catch {
      workoutPlan = { raw: rawOutput };
      nutritionPlan = null;
      notes = '';
    }

    const pdfHtml = generatePdfHtml(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(pdfPath);

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: publicUrl.publicUrl,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes,
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('market').eq('id', client.lead_id).single()
      : { data: null };

    const market = lead?.market || 'GLOBAL';
    const hinglish = isHinglish(market);

    const body = hinglish
      ? `🔥 Week ${week_no} ka plan ready hai, ${client.name || ''}!\n\n` +
        `📄 ${publicUrl.publicUrl}\n\n` +
        (notes ? `💡 ${notes.slice(0, 200)}` : 'Chal, let\'s crush it!')
      : `🔥 Week ${week_no} plan is ready, ${client.name || ''}!\n\n` +
        `📄 ${publicUrl.publicUrl}\n\n` +
        (notes ? `💡 ${notes.slice(0, 200)}` : 'Let\'s crush it!');

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [body],
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.json({ action: 'program_generated', program_id: program.id, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  const prevPlan = prevPrograms?.[0]
    ? `Previous week plan summary: ${JSON.stringify(prevPrograms[0].workout_plan).slice(0, 500)}`
    : 'No previous program data.';

  return `You are an expert fitness coach and program architect for FitnessByMaddy.

CLIENT PROFILE:
- Name: ${client.name || 'Unknown'}
- Program: ${client.program}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/limitations: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No specific preference'}
- Schedule: ${client.schedule || 'Flexible'}

RECENT CHECK-IN DATA:
${checkinSummary || 'No check-in data yet (Week 1).'}

${prevPlan}

TASK: Generate Week ${weekNo} training and nutrition plan.

RULES:
- Be evidence-based. No bro-science.
- Caloric recommendations must be safe (never below 1200 for women, 1500 for men).
- Adapt based on compliance and energy levels from check-ins.
- If injuries are reported, modify exercises to avoid aggravation.
- Progressive overload where appropriate.
- Include rest days.

OUTPUT FORMAT (respond with valid JSON only):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Strength",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "15 min incline walk"
      }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fats_g": 60,
    "meal_timing": "4 meals, pre/post workout nutrition",
    "notes": "Focus on whole foods, adequate hydration"
  },
  "notes": "One-liner coach note for the client"
}`;
}

function generatePdfHtml(client, weekNo, workoutPlan, nutritionPlan, notes) {
  const days = workoutPlan?.days || [];
  const nutrition = nutritionPlan || {};

  const workoutRows = days.map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name}</td>
        <td>${ex.sets} x ${ex.reps}</td>
        <td>${ex.rest || '-'}</td>
        <td>${ex.notes || '-'}</td>
      </tr>`
    ).join('');

    return `<div class="day-block">
      <h3>${day.day} — ${day.focus || ''}</h3>
      <table>
        <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
        <tbody>${exercises}</tbody>
      </table>
      ${day.cardio ? `<p class="cardio">Cardio: ${day.cardio}</p>` : ''}
    </div>`;
  }).join('');

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
  .header { text-align: center; margin-bottom: 48px; border-bottom: 2px solid #B8965A; padding-bottom: 32px; }
  .brand { font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 6px; color: #B8965A; text-transform: uppercase; }
  h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #fff; margin: 12px 0 4px; letter-spacing: 2px; }
  h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; margin: 40px 0 16px; letter-spacing: 1px; }
  h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #fff; margin-bottom: 12px; letter-spacing: 1px; }
  .client-info { font-size: 14px; color: #888; }
  .day-block { background: #141414; border: 1px solid #222; border-radius: 8px; padding: 24px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #B8965A; padding: 8px 12px; border-bottom: 1px solid #333; }
  td { font-size: 14px; color: #ccc; padding: 10px 12px; border-bottom: 1px solid #1a1a1a; }
  .cardio { margin-top: 12px; font-size: 13px; color: #B8965A; font-weight: 500; }
  .nutrition-box { background: #141414; border: 1px solid #B8965A; border-radius: 8px; padding: 32px; margin-top: 16px; }
  .macro-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 20px 0; }
  .macro { text-align: center; }
  .macro-val { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; letter-spacing: 1px; text-transform: uppercase; }
  .notes { background: #1a1a0a; border-left: 3px solid #B8965A; padding: 16px 20px; margin-top: 32px; font-size: 14px; color: #ccc; line-height: 1.6; }
  .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #222; font-size: 12px; color: #555; }
  @media print { body { background: #000; } }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">Fitness by Maddy</div>
    <h1>Week ${weekNo} Program</h1>
    <div class="client-info">${client.name || 'Client'} · ${client.program} · Week ${weekNo}</div>
  </div>

  <h2>Workout Plan</h2>
  ${workoutRows || '<p style="color:#888">No workout data generated.</p>'}

  <h2>Nutrition Plan</h2>
  <div class="nutrition-box">
    <div class="macro-grid">
      <div class="macro"><div class="macro-val">${nutrition.calories || '-'}</div><div class="macro-label">Calories</div></div>
      <div class="macro"><div class="macro-val">${nutrition.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
      <div class="macro"><div class="macro-val">${nutrition.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
      <div class="macro"><div class="macro-val">${nutrition.fats_g || '-'}g</div><div class="macro-label">Fats</div></div>
    </div>
    ${nutrition.meal_timing ? `<p style="color:#ccc; font-size:14px;">${nutrition.meal_timing}</p>` : ''}
    ${nutrition.notes ? `<p style="color:#888; font-size:13px; margin-top:8px;">${nutrition.notes}</p>` : ''}
  </div>

  ${notes ? `<div class="notes"><strong>Coach's Note:</strong> ${notes}</div>` : ''}

  <div class="footer">
    Fitness by Maddy · fitnessbymaddy.com · Generated ${new Date().toLocaleDateString('en-IN')}
  </div>
</body>
</html>`;
}
