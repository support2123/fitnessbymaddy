const { supabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'starvation',
  'banned substance', 'steroid', 'anabolic',
  'lose 10kg in a week', 'crash diet', 'detox tea',
  'fat burner pill', 'laxative'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], lastProgram, week_no);

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => fullText.includes(f));

    if (flagged) {
      const { sendTemplate: st } = require('./_lib/whatsapp');
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy('Safety flag in generated program', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program flagged for review`
      });
      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan || {},
        nutrition_plan: parsed.nutrition_plan || {},
        notes: 'FLAGGED FOR REVIEW — not sent to client'
      });
      return res.status(200).json({ ok: true, flagged: true, phone: maskPhone(client.phone) });
    }

    const pdfContent = buildPdfHtml(client, parsed, week_no);
    const pdfBuffer = Buffer.from(pdfContent, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = supabase.storage.from('client-files').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: progError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || {},
      nutrition_plan: parsed.nutrition_plan || {},
      notes: parsed.notes || null
    });

    if (progError) {
      console.error('Program save error:', progError.message);
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      pdfUrl
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, phone: maskPhone(client.phone) });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand.

Generate Week ${weekNo} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

${lastProgram ? `LAST WEEK'S FOCUS: ${lastProgram.notes || 'General progression'}` : ''}

RULES:
- Provide progressive overload from previous week
- Minimum 1200 kcal/day for women, 1500 for men
- No banned substances, no extreme protocols
- Include rest days
- Adapt based on compliance and energy scores

Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s"}] },
      ...
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] },
      ...
    ],
    "notes": "..."
  },
  "notes": "One-line context for WhatsApp message"
}
\`\`\``;
}

function buildPdfHtml(client, plan, weekNo) {
  const workoutRows = (plan.workout_plan?.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '60s'}</td></tr>`
    ).join('');
    return `<h3 style="color:#B8965A;margin:20px 0 8px;font-family:'Bebas Neue',sans-serif;letter-spacing:2px;">${day.day} — ${day.focus}</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr style="background:#2C2C2C;color:#B8965A;"><th style="padding:8px;text-align:left;">Exercise</th><th style="padding:8px;">Sets x Reps</th><th style="padding:8px;">Rest</th></tr>
      ${exercises}
    </table>`;
  }).join('');

  const nutritionSection = plan.nutrition_plan ? `
    <h2 style="color:#B8965A;font-family:'Bebas Neue',sans-serif;letter-spacing:3px;margin-top:32px;">NUTRITION PLAN</h2>
    <p><strong>Daily Targets:</strong> ${plan.nutrition_plan.calories || '—'} kcal | Protein: ${plan.nutrition_plan.protein_g || '—'}g | Carbs: ${plan.nutrition_plan.carbs_g || '—'}g | Fat: ${plan.nutrition_plan.fat_g || '—'}g</p>
    ${(plan.nutrition_plan.meals || []).map(m =>
      `<p><strong>${m.meal}:</strong> ${(m.options || []).join(' / ')}</p>`
    ).join('')}
    ${plan.nutrition_plan.notes ? `<p style="margin-top:12px;color:#6B6B6B;"><em>${plan.nutrition_plan.notes}</em></p>` : ''}
  ` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;600&display=swap" rel="stylesheet">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  body{font-family:'DM Sans',sans-serif;background:#FAF8F4;color:#2C2C2C;margin:0;padding:24px;max-width:800px;margin:0 auto;}
  h1{font-family:'Bebas Neue',sans-serif;font-size:36px;letter-spacing:4px;color:#2C2C2C;border-bottom:3px solid #B8965A;padding-bottom:12px;}
  h2{font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:3px;}
  table{font-size:14px;}
  td,th{padding:8px;border-bottom:1px solid #E8E3DC;text-align:left;}
  .header{background:#2C2C2C;color:#B8965A;padding:24px;margin:-24px -24px 24px;text-align:center;}
  .header h1{color:#B8965A;border:none;margin:0;}
  .header p{color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;letter-spacing:1px;}
</style></head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <p>WEEK ${weekNo} PROGRAM — ${(client.name || 'CLIENT').toUpperCase()}</p>
  </div>
  <h2 style="color:#B8965A;font-family:'Bebas Neue',sans-serif;letter-spacing:3px;">WORKOUT PLAN</h2>
  ${workoutRows}
  ${nutritionSection}
  <hr style="border:none;border-top:2px solid #B8965A;margin:32px 0;">
  <p style="text-align:center;color:#6B6B6B;font-size:12px;">Generated by FitnessByMaddy Coaching System<br>Questions? Message us on WhatsApp.</p>
</body></html>`;
}
