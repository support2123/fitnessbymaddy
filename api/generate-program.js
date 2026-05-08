const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/mask-phone');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'sarms',
  'steroids', 'anabolic', 'testosterone inject',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified personal trainer and nutrition coach creating a weekly training and nutrition plan for a client. You must output valid JSON only.

RULES:
- Plans must be safe, evidence-based, and appropriate for the client's level
- Never recommend calorie intake below 1200 for women or 1500 for men
- Never recommend banned substances, steroids, or extreme protocols
- Never promise unrealistic timelines
- All exercises must include sets, reps, and rest periods
- Nutrition must include daily calories, macros, and meal timing

Output format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "cardio": { "frequency": "3x/week", "type": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "time": "8am", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_focus": "...",
  "notes_for_client": "..."
}`;

    const checkinSummary = recentCheckins && recentCheckins.length > 0
      ? recentCheckins.map(c =>
          `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues=${c.issues || 'none'}`
        ).join('\n')
      : 'No previous check-ins available.';

    const userPrompt = `Create the Week ${week_no} program for this client:

Name: ${client.name}
Program: ${client.program}
Started: ${client.program_started_at}

Recent check-in data:
${checkinSummary}

Generate a progressive, personalized plan for Week ${week_no}. Adjust based on their compliance, energy levels, and any reported issues.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      await notifyMaddy(
        'Program generation parse error',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nCould not parse Claude response`
      );
      return res.status(500).json({ error: 'failed to parse program' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));

    if (flagged) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nFlagged content detected — manual review required before sending.`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: 'FLAGGED FOR REVIEW: ' + (parsed.notes_for_client || '')
      });

      return res.status(200).json({ action: 'flagged_for_review' });
    }

    const pdfContent = generatePdfHtml(client, week_no, parsed);
    const pdfBuffer = Buffer.from(pdfContent, 'utf-8');
    const pdfPath = `clients/${client.id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes_for_client || '',
      whatsapp_sent_at: new Date().toISOString()
    });

    const contextNote = parsed.weekly_focus
      ? `Week ${week_no} focus: ${parsed.weekly_focus}`
      : `Your Week ${week_no} program is ready!`;

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(week_no), contextNote],
      media: { url: pdfUrl }
    });

    return res.status(200).json({
      action: 'generated_and_sent',
      program_url: pdfUrl
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'generation failed' });
  }
};

function generatePdfHtml(client, weekNo, plan) {
  const workoutRows = (plan.workout_plan?.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `<h3 style="color:#B8965A;margin:24px 0 8px;">${day.day} — ${day.focus}</h3>
    <table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead><tbody>${exercises}</tbody></table>`;
  }).join('');

  const meals = (plan.nutrition_plan?.meals || []).map(m =>
    `<div style="margin:8px 0;"><strong>${m.meal} (${m.time})</strong><br>${(m.options || []).join(', ')}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#fff;padding:40px 24px}
h1,h2{font-family:'Bebas Neue',sans-serif;letter-spacing:2px}
h1{font-size:48px;color:#B8965A;margin-bottom:8px}
h2{font-size:28px;color:#fff;margin:32px 0 16px;border-bottom:2px solid #B8965A;padding-bottom:8px}
h3{font-family:'Bebas Neue',sans-serif}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #333}
th{color:#B8965A;font-size:12px;text-transform:uppercase;letter-spacing:1px}
td{font-size:14px;color:#ccc}
.header{text-align:center;margin-bottom:40px;padding-bottom:24px;border-bottom:1px solid #333}
.subtitle{color:#888;font-size:14px;letter-spacing:1px}
.macro-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:16px 0}
.macro-box{background:#222;padding:16px;border-radius:8px;text-align:center}
.macro-val{font-family:'Bebas Neue',sans-serif;font-size:36px;color:#B8965A}
.macro-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px}
.notes{background:#222;padding:24px;border-radius:8px;margin-top:32px;border-left:4px solid #B8965A}
.footer{text-align:center;margin-top:40px;padding-top:24px;border-top:1px solid #333;color:#555;font-size:12px}
</style></head><body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <div class="subtitle">${client.name || 'Client'} — Week ${weekNo} Program</div>
</div>

<h2>WORKOUT PLAN</h2>
${workoutRows}
${plan.workout_plan?.cardio ? `<div style="margin-top:16px;padding:16px;background:#222;border-radius:8px"><strong style="color:#B8965A">Cardio:</strong> ${plan.workout_plan.cardio.frequency} — ${plan.workout_plan.cardio.type} for ${plan.workout_plan.cardio.duration}</div>` : ''}

<h2>NUTRITION PLAN</h2>
<div class="macro-grid">
  <div class="macro-box"><div class="macro-val">${plan.nutrition_plan?.daily_calories || '—'}</div><div class="macro-label">Calories</div></div>
  <div class="macro-box"><div class="macro-val">${plan.nutrition_plan?.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
  <div class="macro-box"><div class="macro-val">${plan.nutrition_plan?.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
  <div class="macro-box"><div class="macro-val">${plan.nutrition_plan?.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
</div>
${meals}

${plan.notes_for_client ? `<div class="notes"><strong>Notes from Coach:</strong><br>${plan.notes_for_client}</div>` : ''}
<div class="footer">FITNESS BY MADDY &copy; ${new Date().getFullYear()} — This program is for personal use only.</div>
</body></html>`;
}
