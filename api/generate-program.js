const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { escalate } = require('../lib/escalation');
const { isHinglish } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  '10kg in 1 week', '20 pounds in a week', 'crash diet',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const prompt = buildPrompt(client, lead, recentCheckins, week_no);

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a certified fitness coach program architect for Fitness by Maddy.
Generate structured, safe, science-backed workout and nutrition plans.
Always output valid JSON with "workout_plan" and "nutrition_plan" keys.
Never recommend extreme calorie deficits (<1200 cal for women, <1500 cal for men),
banned substances, or unrealistic timelines.
Tone: warm, expert, encouraging. Never bro-sciency.`,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      await escalate(client.phone, 'Program generation parse error', content.slice(0, 500), client_id);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
    if (flagged) {
      await escalate(client.phone, 'Safety flag in generated program', fullText.slice(0, 500), client_id);
      return res.json({ action: 'flagged_for_review', week_no });
    }

    const pdfHtml = renderProgramHtml(client, parsed, week_no);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `${client.folder_url || `clients/${client_id}`}/week_${week_no}.html`;

    await supabase.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: publicUrl } = supabase.storage.from('clients').getPublicUrl(pdfPath);

    const { error } = await supabase.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl.publicUrl || pdfPath,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes || null,
    }, {
      onConflict: 'client_id,week_no',
    });

    if (error) throw error;

    const market = lead?.market || 'IN';
    const contextNote = parsed.notes || `Week ${week_no} program ready!`;

    await sendTemplate(client.phone,
      isHinglish(market) ? 'weekly_program_hi' : 'weekly_program_en',
      [client.name || 'there', week_no.toString(), contextNote]
    );

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.json({ ok: true, week_no, client_id });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, lead, checkins, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `Generate Week ${weekNo} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (first week)'}

INSTRUCTIONS:
- Create a 7-day workout plan appropriate for week ${weekNo}
- Create a matching nutrition plan (meals, macros, calories)
- Add a short motivational "notes" field (1-2 sentences)
- Progressive overload from previous weeks if data available
- Account for any issues mentioned in check-ins
- Output strictly as JSON: { "workout_plan": {...}, "nutrition_plan": {...}, "notes": "..." }

WORKOUT PLAN FORMAT:
{ "days": [ { "day": "Monday", "focus": "Upper Body Push", "exercises": [ { "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" } ] } ] }

NUTRITION PLAN FORMAT:
{ "daily_calories": 2200, "protein_g": 150, "carbs_g": 250, "fat_g": 70, "meals": [ { "name": "Breakfast", "foods": ["..."], "calories": 500 } ] }`;
}

function renderProgramHtml(client, program, weekNo) {
  const workoutDays = (program.workout_plan?.days || []).map(day => `
    <div style="margin-bottom:24px;padding:20px;background:#1a1a1a;border-radius:4px;border-left:3px solid #B8965A;">
      <h3 style="color:#B8965A;font-family:'Cormorant Garamond',serif;font-size:20px;margin-bottom:12px;">${day.day} — ${day.focus}</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:1px;">
          <th style="text-align:left;padding:8px 0;border-bottom:1px solid #333;">Exercise</th>
          <th style="text-align:center;padding:8px 0;border-bottom:1px solid #333;">Sets</th>
          <th style="text-align:center;padding:8px 0;border-bottom:1px solid #333;">Reps</th>
          <th style="text-align:center;padding:8px 0;border-bottom:1px solid #333;">Rest</th>
        </tr>
        ${(day.exercises || []).map(ex => `
          <tr style="color:#ddd;font-size:14px;">
            <td style="padding:8px 0;border-bottom:1px solid #222;">${ex.name}</td>
            <td style="text-align:center;padding:8px 0;border-bottom:1px solid #222;">${ex.sets}</td>
            <td style="text-align:center;padding:8px 0;border-bottom:1px solid #222;">${ex.reps}</td>
            <td style="text-align:center;padding:8px 0;border-bottom:1px solid #222;">${ex.rest || '60s'}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `).join('');

  const nutrition = program.nutrition_plan || {};
  const meals = (nutrition.meals || []).map(meal => `
    <div style="padding:12px 0;border-bottom:1px solid #222;">
      <strong style="color:#B8965A;">${meal.name}</strong> <span style="color:#666;font-size:12px;">(~${meal.calories} cal)</span>
      <div style="color:#aaa;font-size:13px;margin-top:4px;">${(meal.foods || []).join(', ')}</div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} — ${client.name || 'Client'} | Fitness by Maddy</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#0d0d0d;color:#eee;font-family:'DM Sans',sans-serif;">
<div style="max-width:700px;margin:0 auto;padding:40px 24px;">
  <div style="text-align:center;margin-bottom:48px;">
    <div style="font-family:'Cormorant Garamond',serif;font-size:18px;letter-spacing:4px;color:#B8965A;text-transform:uppercase;margin-bottom:8px;">Fitness by Maddy</div>
    <h1 style="font-family:'Cormorant Garamond',serif;font-size:42px;font-weight:300;color:white;margin:0;">Week ${weekNo} <em style="color:#B8965A;">Program</em></h1>
    <p style="color:#666;font-size:13px;margin-top:8px;letter-spacing:1px;text-transform:uppercase;">${client.name || 'Client'} | ${client.program}</p>
  </div>

  <h2 style="font-family:'Cormorant Garamond',serif;font-size:28px;color:white;margin-bottom:24px;border-bottom:1px solid #333;padding-bottom:12px;">
    Workout <em style="color:#B8965A;">Plan</em>
  </h2>
  ${workoutDays}

  <h2 style="font-family:'Cormorant Garamond',serif;font-size:28px;color:white;margin:48px 0 24px;border-bottom:1px solid #333;padding-bottom:12px;">
    Nutrition <em style="color:#B8965A;">Plan</em>
  </h2>
  <div style="display:flex;gap:24px;margin-bottom:24px;flex-wrap:wrap;">
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:4px;text-align:center;flex:1;min-width:120px;">
      <div style="font-size:28px;font-weight:600;color:#B8965A;">${nutrition.daily_calories || '—'}</div>
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;">Calories</div>
    </div>
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:4px;text-align:center;flex:1;min-width:120px;">
      <div style="font-size:28px;font-weight:600;color:white;">${nutrition.protein_g || '—'}g</div>
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;">Protein</div>
    </div>
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:4px;text-align:center;flex:1;min-width:120px;">
      <div style="font-size:28px;font-weight:600;color:white;">${nutrition.carbs_g || '—'}g</div>
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;">Carbs</div>
    </div>
    <div style="background:#1a1a1a;padding:16px 24px;border-radius:4px;text-align:center;flex:1;min-width:120px;">
      <div style="font-size:28px;font-weight:600;color:white;">${nutrition.fat_g || '—'}g</div>
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px;">Fat</div>
    </div>
  </div>
  ${meals}

  ${program.notes ? `
  <div style="margin-top:48px;padding:24px;background:linear-gradient(135deg,#1a1500,#0d0d0d);border:1px solid #B8965A33;border-radius:4px;">
    <p style="color:#B8965A;font-family:'Cormorant Garamond',serif;font-size:20px;font-style:italic;margin:0;">"${program.notes}"</p>
    <p style="color:#666;font-size:12px;margin-top:8px;">— Coach Maddy</p>
  </div>` : ''}

  <div style="text-align:center;margin-top:60px;padding-top:24px;border-top:1px solid #222;">
    <div style="color:#666;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Fitness by Maddy</div>
    <div style="color:#444;font-size:11px;margin-top:4px;">This program is personalised for you. Do not share or redistribute.</div>
  </div>
</div>
</body></html>`;
}
