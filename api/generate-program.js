const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, parseBody, jsonResp, corsHeaders } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResp(res, 405, { error: 'Method not allowed' });

  const db = getSupabase();
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return jsonResp(res, 400, { error: 'Invalid request body' });
  }

  const { client_id, week_no } = body;
  if (!client_id || !week_no) {
    return jsonResp(res, 400, { error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return jsonResp(res, 404, { error: 'Client not found' });

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: lead } = client.lead_id
    ? await db.from('leads').select('intake_data').eq('id', client.lead_id).single()
    : { data: null };

  const prompt = buildProgramPrompt(client, recentCheckins || [], lead?.intake_data, week_no);

  let programData;
  try {
    const claudeResp = await fetch(CLAUDE_API, {
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

    const claudeResult = await claudeResp.json();
    const content = claudeResult.content?.[0]?.text || '';

    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');

    programData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
  } catch (e) {
    console.error('Claude API error:', e.message);
    return jsonResp(res, 500, { error: 'Program generation failed' });
  }

  if (hasSafetyIssues(programData)) {
    await escalateToMaddy('Generated program flagged for safety review', {
      phone: client.phone,
      name: client.name,
      message: `Week ${week_no} program contains potentially risky recommendations. Halted for review.`,
    });
    return jsonResp(res, 200, { action: 'flagged_for_review', week_no });
  }

  const pdfHtml = renderProgramPdf(client, programData, week_no);
  const pdfPath = `clients/${client_id}/week_${week_no}.html`;
  await db.storage
    .from('client-files')
    .upload(pdfPath, pdfHtml, { contentType: 'text/html', upsert: true });

  const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);
  const pdfUrl = urlData.publicUrl;

  const { error: insertError } = await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan || programData.workout || {},
    nutrition_plan: programData.nutrition_plan || programData.nutrition || {},
    notes: programData.notes || '',
  });

  if (insertError) {
    console.error('Program insert error:', insertError.message);
    return jsonResp(res, 500, { error: 'Failed to save program' });
  }

  const market = detectMarket(client.phone);
  const contextNote = programData.context_note ||
    `Week ${week_no} program ready! Check your updated plan.`;
  const template = market === 'IN' ? 'weekly_program_hi' : 'weekly_program_en';
  await sendWhatsApp(client.phone, template, [
    client.name || 'there',
    `Week ${week_no}`,
    contextNote,
  ], pdfUrl);

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return jsonResp(res, 200, {
    action: 'program_generated',
    client_id,
    week_no,
    pdf_url: pdfUrl,
  });
};

function buildProgramPrompt(client, checkins, intakeData, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let context = `You are a certified personal trainer and nutrition coach creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
`;

  if (intakeData) {
    context += `
INTAKE DATA:
- Age: ${intakeData.age || 'N/A'}
- Gender: ${intakeData.gender || 'N/A'}
- Height: ${intakeData.height || 'N/A'}
- Current Weight: ${intakeData.weight || 'N/A'}
- Goal: ${intakeData.goal || 'N/A'}
- Injuries: ${intakeData.injuries || 'None'}
- Medical Conditions: ${intakeData.medical_conditions || 'None'}
- Diet Preference: ${intakeData.diet_preference || 'No preference'}
- Training Experience: ${intakeData.training_experience || 'N/A'}
- Equipment: ${intakeData.available_equipment || 'Full gym'}
- Schedule: ${intakeData.weekly_schedule || 'N/A'}
`;
  }

  if (lastCheckin) {
    context += `
LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}
`;
  }

  if (prevCheckin) {
    context += `
PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10
`;
  }

  context += `
OUTPUT FORMAT: Return a JSON object with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS", "duration": "30 min" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fats_g": 70,
    "meal_timing": ["7am - Breakfast", "12pm - Lunch", "4pm - Snack", "7pm - Dinner"],
    "notes": "Focus on lean protein sources"
  },
  "notes": "Overall coaching notes for this week",
  "context_note": "One-liner message to send with the program on WhatsApp"
}

SAFETY RULES:
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned substances or supplements without evidence
- Never promise specific weight loss timelines
- If the client reported pain or injury, adapt exercises accordingly
- Progressive overload should be gradual and sustainable
`;

  return context;
}

function hasSafetyIssues(data) {
  if (!data) return true;

  const nutrition = data.nutrition_plan || data.nutrition || {};
  const calories = nutrition.calories || nutrition.daily_calories || 0;
  if (calories > 0 && calories < 1200) return true;

  const notes = JSON.stringify(data).toLowerCase();
  const banned = ['dnp', 'clenbuterol', 'anabolic steroid', 'sarm', 'hgh injection'];
  if (banned.some(b => notes.includes(b))) return true;

  return false;
}

function renderProgramPdf(client, data, weekNo) {
  const workout = data.workout_plan || data.workout || {};
  const nutrition = data.nutrition_plan || data.nutrition || {};
  const days = workout.days || [];

  let workoutHtml = '';
  for (const day of days) {
    workoutHtml += `<div class="day-block">
      <h3>${day.day} — ${day.focus || ''}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>
        ${(day.exercises || []).map(ex =>
          `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest || ''}</td><td>${ex.notes || ''}</td></tr>`
        ).join('')}
      </table>
    </div>`;
  }

  if (workout.cardio) {
    workoutHtml += `<div class="day-block">
      <h3>Cardio</h3>
      <p>${workout.cardio.frequency || ''} — ${workout.cardio.type || ''} — ${workout.cardio.duration || ''}</p>
    </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px 24px; }
  .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #B8965A; padding-bottom: 24px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: 4px; color: #B8965A; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 24px; letter-spacing: 2px; color: #fff; margin-top: 8px; }
  .header p { font-size: 13px; color: rgba(255,255,255,0.5); margin-top: 4px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 3px; color: #B8965A; margin: 32px 0 16px; }
  .day-block { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 20px; margin-bottom: 16px; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2px; color: #D4AF7A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.2); color: #B8965A; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
  td { padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); color: rgba(255,255,255,0.8); }
  .nutrition-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 16px; }
  .macro-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 16px; text-align: center; }
  .macro-value { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; }
  .macro-label { font-size: 11px; color: rgba(255,255,255,0.5); letter-spacing: 1px; text-transform: uppercase; margin-top: 4px; }
  .notes { background: rgba(184,150,90,0.1); border-left: 3px solid #B8965A; padding: 16px; margin-top: 24px; font-size: 14px; line-height: 1.7; color: rgba(255,255,255,0.8); }
  .footer { text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: rgba(255,255,255,0.3); }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name} — ${client.program.toUpperCase()}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${workoutHtml}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition-grid">
    <div class="macro-card">
      <div class="macro-value">${nutrition.calories || '—'}</div>
      <div class="macro-label">Daily Calories</div>
    </div>
    <div class="macro-card">
      <div class="macro-value">${nutrition.protein_g || '—'}g</div>
      <div class="macro-label">Protein</div>
    </div>
    <div class="macro-card">
      <div class="macro-value">${nutrition.carbs_g || '—'}g</div>
      <div class="macro-label">Carbs</div>
    </div>
    <div class="macro-card">
      <div class="macro-value">${nutrition.fats_g || '—'}g</div>
      <div class="macro-label">Fats</div>
    </div>
  </div>
  ${nutrition.notes ? `<div class="notes">${nutrition.notes}</div>` : ''}

  ${data.notes ? `<div class="section-title">COACHING NOTES</div><div class="notes">${data.notes}</div>` : ''}

  <div class="footer">
    FITNESS BY MADDY &mdash; fitnessbymaddy.com<br>
    Generated ${new Date().toLocaleDateString('en-IN')}
  </div>
</body>
</html>`;
}
