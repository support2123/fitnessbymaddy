const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { corsHeaders, parseBody, programDisplayName } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_KEYWORDS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'crash diet'
];

function checkSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_KEYWORDS.some(kw => lower.includes(kw));
}

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    // Get client data
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get intake form data from messages
    const { data: intakeMessages } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .like('body', '%[INTAKE FORM]%')
      .order('sent_at', { ascending: false })
      .limit(1);

    let intakeData = {};
    if (intakeMessages && intakeMessages[0]) {
      try {
        const jsonStr = intakeMessages[0].body.replace('[INTAKE FORM] ', '');
        intakeData = JSON.parse(jsonStr);
      } catch (e) { /* ignore parse errors */ }
    }

    // Build Claude prompt
    const clientProfile = {
      name: client.name,
      program: programDisplayName(client.program),
      week: week_no,
      totalWeeks: client.program === '12wk' ? 12 : 6,
      startDate: client.program_started_at,
      ...intakeData
    };

    const checkinSummary = (checkins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const systemPrompt = `You are a NASM-certified fitness program architect working for Fitness by Maddy, an elite online coaching brand. You create personalized weekly workout and nutrition plans.

RULES:
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned substances, SARMs, steroids, or dangerous supplements
- Never promise unrealistic timelines (e.g., "lose 10kg in 1 week")
- Always include rest days and deload guidance
- Be specific with exercises, sets, reps, and rest periods
- Nutrition should include practical meal suggestions, not just macros
- Consider any injuries, medical conditions, or dietary restrictions

OUTPUT FORMAT: Return valid JSON with this exact structure:
{
  "workout_plan": {
    "overview": "string",
    "days": [
      {
        "day": "Monday",
        "focus": "string",
        "exercises": [
          { "name": "string", "sets": number, "reps": "string", "rest": "string", "notes": "string" }
        ]
      }
    ],
    "notes": "string"
  },
  "nutrition_plan": {
    "daily_calories": number,
    "protein_g": number,
    "carbs_g": number,
    "fats_g": number,
    "meals": [
      { "meal": "string", "time": "string", "foods": "string", "macros": "string" }
    ],
    "notes": "string"
  },
  "weekly_focus": "string",
  "coach_note": "string"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${checkinSummary.length > 0 ? JSON.stringify(checkinSummary, null, 2) : 'No check-ins yet (first week)'}

Create a progressive, personalized program for this week. If there are check-ins, adjust based on compliance, energy levels, and any reported issues.`;

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = message.content[0].text;

    // Safety check
    if (checkSafety(responseText)) {
      await escalateToMaddy(
        'Unsafe program content detected',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nContent flagged for review.`
      );
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    // Parse the JSON response
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    // Generate branded HTML document
    const htmlContent = generateProgramHTML(client, week_no, programData);

    // Upload to Supabase storage
    const fileName = `clients/${client_id}/week_${week_no}.html`;
    const { error: uploadErr } = await db.storage
      .from('client-files')
      .upload(fileName, Buffer.from(htmlContent), {
        contentType: 'text/html',
        upsert: true
      });

    if (uploadErr) {
      console.error('Upload error:', uploadErr.message);
    }

    const { data: urlData } = db.storage.from('client-files').getPublicUrl(fileName);
    const pdfUrl = urlData?.publicUrl || fileName;

    // Save to programs table
    const { data: programRecord } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      whatsapp_sent_at: null,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || ''
    }).select().single();

    // Send via WhatsApp
    const coachNote = programData.coach_note || `Your Week ${week_no} program is ready!`;
    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      coachNote
    ], true);

    // Update sent timestamp
    if (programRecord) {
      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', programRecord.id);
    }

    return res.status(200).json({
      success: true,
      program_id: programRecord?.id,
      pdf_url: pdfUrl
    });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generateProgramHTML(client, weekNo, data) {
  const workout = data.workout_plan || {};
  const nutrition = data.nutrition_plan || {};
  const days = workout.days || [];
  const meals = nutrition.meals || [];

  const daysHTML = days.map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name}</td>
        <td>${ex.sets} × ${ex.reps}</td>
        <td>${ex.rest || '-'}</td>
        <td>${ex.notes || ''}</td>
      </tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.day} — ${day.focus}</h3>
        <table>
          <thead><tr><th>Exercise</th><th>Sets × Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
      </div>`;
  }).join('');

  const mealsHTML = meals.map(m =>
    `<tr>
      <td><strong>${m.meal}</strong></td>
      <td>${m.time || ''}</td>
      <td>${m.foods}</td>
      <td>${m.macros || ''}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #111; color: #fff; padding: 40px 24px; }
  .container { max-width: 800px; margin: 0 auto; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
  .brand { font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 6px; color: #B8965A; text-transform: uppercase; }
  h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #fff; letter-spacing: 3px; margin: 16px 0 8px; }
  h2 { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 2px; margin: 40px 0 20px; border-bottom: 1px solid #333; padding-bottom: 10px; }
  h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #fff; letter-spacing: 1px; margin-bottom: 12px; }
  .subtitle { color: #888; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; }
  .overview { background: #1a1a1a; padding: 24px; border-left: 3px solid #B8965A; margin: 24px 0; font-size: 15px; line-height: 1.7; color: #ccc; }
  .day-block { background: #1a1a1a; padding: 24px; margin-bottom: 16px; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #B8965A; padding: 8px 12px; border-bottom: 1px solid #333; }
  td { padding: 10px 12px; font-size: 14px; color: #ddd; border-bottom: 1px solid #222; }
  .macros-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0; }
  .macro-card { background: #1a1a1a; padding: 20px; text-align: center; border-radius: 4px; }
  .macro-value { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-top: 4px; }
  .coach-note { background: linear-gradient(135deg, #1a1a1a, #222); padding: 24px; border-radius: 4px; margin-top: 40px; border: 1px solid #B8965A; }
  .coach-note p { font-size: 15px; line-height: 1.7; color: #ccc; font-style: italic; }
  .footer { text-align: center; margin-top: 60px; padding-top: 24px; border-top: 1px solid #333; }
  .footer p { font-size: 12px; color: #555; letter-spacing: 1px; }
  @media print { body { background: #fff; color: #000; } .day-block, .overview, .macro-card, .coach-note { background: #f5f5f5; } td, th { color: #333; } h1, h3 { color: #000; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="brand">Fitness by Maddy</div>
    <h1>Week ${weekNo} Program</h1>
    <div class="subtitle">${client.name} · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
  </div>

  ${workout.overview ? `<div class="overview">${workout.overview}</div>` : ''}

  <h2>Workout Plan</h2>
  ${daysHTML}
  ${workout.notes ? `<div class="overview" style="margin-top:24px"><strong>Training Notes:</strong> ${workout.notes}</div>` : ''}

  <h2>Nutrition Plan</h2>
  <div class="macros-grid">
    <div class="macro-card"><div class="macro-value">${nutrition.daily_calories || '-'}</div><div class="macro-label">Calories</div></div>
    <div class="macro-card"><div class="macro-value">${nutrition.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro-card"><div class="macro-value">${nutrition.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro-card"><div class="macro-value">${nutrition.fats_g || '-'}g</div><div class="macro-label">Fats</div></div>
  </div>

  ${meals.length > 0 ? `
  <div class="day-block">
    <h3>Meal Plan</h3>
    <table>
      <thead><tr><th>Meal</th><th>Time</th><th>Foods</th><th>Macros</th></tr></thead>
      <tbody>${mealsHTML}</tbody>
    </table>
  </div>` : ''}

  ${nutrition.notes ? `<div class="overview"><strong>Nutrition Notes:</strong> ${nutrition.notes}</div>` : ''}

  ${data.coach_note ? `
  <div class="coach-note">
    <h3>Coach's Note</h3>
    <p>${data.coach_note}</p>
  </div>` : ''}

  <div class="footer">
    <p>FITNESS BY MADDY · NASM CERTIFIED · fitnessbymaddy.com</p>
  </div>
</div>
</body>
</html>`;
}
