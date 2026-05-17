const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroids', 'sarms',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('intake_data')
      .eq('id', client.lead_id)
      .single();

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Create evidence-based, safe, progressive workout and nutrition plans.

RULES:
- Never prescribe below 1200 kcal/day for women or 1500 for men
- Never recommend banned substances
- Progressive overload principles
- Account for injuries and medical conditions
- Output valid JSON only

Output format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [...] }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 130,
    "carbs_g": 200,
    "fat_g": 60,
    "meal_timing": [...],
    "notes": "..."
  },
  "week_focus": "...",
  "coach_note": "..."
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${lead?.intake_data ? `- Intake data: ${JSON.stringify(lead.intake_data)}` : ''}

RECENT CHECK-INS:
${checkins && checkins.length > 0
  ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')
  : 'No previous check-ins (first week)'}

Generate the complete program for Week ${week_no}. Output JSON only.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const generatedText = response.content[0].text;

    if (hasSafetyIssue(generatedText)) {
      await escalateToMaddy('Safety flag in generated program', {
        phone: client.phone,
        message: `Week ${week_no} program flagged for review. Client: ${client.name}`
      });
      return res.status(200).json({ flagged: true, reason: 'safety_review' });
    }

    let programData;
    try {
      const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const pdfHtml = generatePdfHtml(client, week_no, programData);
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfHtml, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);

    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: urlData.publicUrl,
      whatsapp_sent_at: null,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || null
    });

    if (progErr) {
      console.error('Program insert error:', progErr.message);
    }

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      programData.week_focus || 'Progressive training',
      urlData.publicUrl
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: urlData.publicUrl });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePdfHtml(client, weekNo, data) {
  const exercises = data.workout_plan?.days?.map(day => `
    <div class="day-block">
      <h3>${day.day} — ${day.focus}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr>
        ${(day.exercises || []).map(ex => `
          <tr>
            <td>${ex.name || ex}</td>
            <td>${ex.sets || '-'}</td>
            <td>${ex.reps || '-'}</td>
            <td>${ex.rest || '60s'}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `).join('') || '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Week ${weekNo} Program - ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
  .header { text-align: center; border-bottom: 2px solid #B8965A; padding-bottom: 30px; margin-bottom: 40px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; margin-top: 8px; }
  .header p { color: #999; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #B8965A; margin: 30px 0 16px; letter-spacing: 2px; }
  .day-block { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #fff; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #B8965A; padding: 8px 0; border-bottom: 1px solid #333; }
  td { font-size: 14px; padding: 10px 0; border-bottom: 1px solid #2a2a2a; color: #ddd; }
  .nutrition-box { background: #222; border-radius: 8px; padding: 24px; border-left: 3px solid #B8965A; }
  .macro-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 16px; }
  .macro-item { text-align: center; }
  .macro-value { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; }
  .coach-note { background: #1e2a1e; border: 1px solid #2a4a2a; border-radius: 8px; padding: 20px; margin-top: 30px; }
  .coach-note p { color: #8fbc8f; font-size: 14px; line-height: 1.6; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; color: #666; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name || 'Client'} | ${client.program.replace(/_/g, ' ').toUpperCase()}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${exercises}
  ${data.workout_plan?.rest_days ? `<p style="color:#999; margin-top:12px;">Rest days: ${data.workout_plan.rest_days.join(', ')}</p>` : ''}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition-box">
    <div class="macro-grid">
      <div class="macro-item"><div class="macro-value">${data.nutrition_plan?.daily_calories || '-'}</div><div class="macro-label">Calories</div></div>
      <div class="macro-item"><div class="macro-value">${data.nutrition_plan?.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
      <div class="macro-item"><div class="macro-value">${data.nutrition_plan?.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
      <div class="macro-item"><div class="macro-value">${data.nutrition_plan?.fat_g || '-'}g</div><div class="macro-label">Fat</div></div>
    </div>
    ${data.nutrition_plan?.notes ? `<p style="color:#ccc; margin-top:16px; font-size:14px;">${data.nutrition_plan.notes}</p>` : ''}
  </div>

  ${data.coach_note ? `
  <div class="coach-note">
    <p><strong>Coach Note:</strong> ${data.coach_note}</p>
  </div>` : ''}

  <div class="footer">
    <p>FitnessByMaddy | fitnessbymaddy.com | Generated ${new Date().toLocaleDateString('en-IN')}</p>
  </div>
</body>
</html>`;
}
