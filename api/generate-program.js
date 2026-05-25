const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendText } = require('./_lib/whatsapp');
const { escalate } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/helpers');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'sarms', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for weight loss'
];

function checkSafety(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.filter(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: leadData } = await supabase
      .from('leads')
      .select('first_msg')
      .eq('id', client.lead_id)
      .maybeSingle();

    let intakeInfo = {};
    try {
      intakeInfo = JSON.parse(leadData?.first_msg || '{}');
    } catch (e) {
      intakeInfo = { note: leadData?.first_msg || 'No intake data' };
    }

    const prompt = buildPrompt(client, intakeInfo, recentCheckins || [], week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    const flags = checkSafety(responseText);
    if (flags.length > 0) {
      await escalate(client.phone, `Safety flag in program: ${flags.join(', ')}`, responseText.slice(0, 500));
      return res.json({ ok: false, reason: 'safety_flagged', flags });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch (e) {
      parsed = { raw: responseText };
    }

    const workoutPlan = parsed.workout_plan || parsed.workouts || parsed;
    const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    const notes = parsed.notes || parsed.coach_notes || '';

    const pdfHtml = buildPdfHtml(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'text/html',
        upsert: true
      });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes
      })
      .select()
      .single();

    if (error) throw error;

    const msg = `Hey ${client.name || 'Champion'}! 💪 Your Week ${week_no} program is ready!\n\n📋 ${pdfUrl}\n\nLet's crush it this week! Any questions, just ask.`;
    const sendResult = await sendText(client.phone, msg, true);

    if (sendResult.ok) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'None'}`
  ).join('\n');

  return `You are an expert fitness coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Current Weight: ${intake.current_weight || 'Unknown'}
- Target Weight: ${intake.target_weight || 'Unknown'}
- Height: ${intake.height || 'Unknown'}
- Experience: ${intake.experience || 'Unknown'}
- Injuries/Limitations: ${intake.injuries || 'None reported'}
- Diet Preference: ${intake.diet_pref || 'No preference'}
- Schedule: ${intake.schedule || 'Flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

TASK: Generate Week ${weekNo} workout and nutrition plan.

RULES:
- Be progressive: build on previous weeks
- Respect injuries and limitations
- Use RPE-based intensity (not just percentages)
- Include warm-up and cooldown
- Nutrition must be sustainable (no extreme deficits)
- Minimum 1200 calories for women, 1500 for men
- Never recommend banned substances or extreme protocols

OUTPUT FORMAT (JSON):
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rpe": 7, "notes": "" }
        ],
        "warmup": "5 min cardio + dynamic stretches",
        "cooldown": "5 min static stretches"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "suggestion": "Oats with protein powder and banana" }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Multivitamin"]
  },
  "notes": "Focus on progressive overload this week. Increase weights by 2.5kg on compound movements if RPE was below 7 last week."
}
\`\`\``;
}

function buildPdfHtml(client, weekNo, workout, nutrition, notes) {
  const days = workout?.days || [];
  const daysHtml = days.map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>RPE ${ex.rpe || '-'}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.day} — ${day.focus || ''}</h3>
        <p class="warmup">Warm-up: ${day.warmup || 'General warm-up'}</p>
        <table>
          <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Intensity</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
        <p class="cooldown">Cool-down: ${day.cooldown || 'Stretching'}</p>
      </div>`;
  }).join('');

  const meals = (nutrition?.meals || []).map(m =>
    `<li><strong>${m.meal}:</strong> ${m.suggestion}</li>`
  ).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px 24px; }
  .container { max-width: 800px; margin: 0 auto; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 32px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 3px; margin: 32px 0 16px; }
  .day-block { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #B8965A; letter-spacing: 2px; margin-bottom: 12px; }
  .warmup, .cooldown { font-size: 13px; color: #888; margin: 8px 0; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #B8965A; padding: 8px 4px; border-bottom: 1px solid #333; }
  td { padding: 8px 4px; font-size: 14px; border-bottom: 1px solid #2a2a2a; color: #ddd; }
  .nutrition-box { background: #222; border-radius: 8px; padding: 24px; border-left: 3px solid #B8965A; }
  .macros { display: flex; gap: 24px; margin: 16px 0; flex-wrap: wrap; }
  .macro { text-align: center; }
  .macro-val { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; }
  ul { list-style: none; margin: 16px 0; }
  li { padding: 6px 0; font-size: 14px; color: #ddd; border-bottom: 1px solid #2a2a2a; }
  li strong { color: #B8965A; }
  .notes { background: #1e1e1e; border: 1px solid #333; border-radius: 8px; padding: 20px; margin-top: 24px; font-size: 14px; color: #aaa; line-height: 1.7; }
  .footer { text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid #333; color: #555; font-size: 12px; }
</style>
</head><body>
<div class="container">
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name || 'Client'} · ${client.program?.toUpperCase() || ''}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${daysHtml || '<p style="color:#888">No workout data generated.</p>'}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition-box">
    <div class="macros">
      <div class="macro"><div class="macro-val">${nutrition?.calories || '—'}</div><div class="macro-label">Calories</div></div>
      <div class="macro"><div class="macro-val">${nutrition?.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
      <div class="macro"><div class="macro-val">${nutrition?.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
      <div class="macro"><div class="macro-val">${nutrition?.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
    </div>
    <ul>${meals || '<li>No meal plan generated.</li>'}</ul>
    <p style="margin-top:12px; font-size:13px; color:#888">Hydration: ${nutrition?.hydration || '3L+ water daily'}</p>
  </div>

  ${notes ? `<div class="notes"><strong style="color:#B8965A">Coach Notes:</strong><br>${notes}</div>` : ''}

  <div class="footer">
    FITNESS BY MADDY · NASM Certified · fitnessbymaddy.com
  </div>
</div>
</body></html>`;
}
