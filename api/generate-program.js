const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsAppDirect } = require('../lib/whatsapp');
const { isHinglishMarket, detectMarket, maskPhone } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

const SAFETY_FLAGS = [
  'below 1200 calories', 'under 1000 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are "Program Architect" for FitnessByMaddy, an elite online coaching brand.
You generate weekly personalized workout and nutrition plans.

RULES:
- Never recommend calorie intake below 1200 for women or 1500 for men
- Never recommend banned substances, SARMs, steroids, or any prohibited compound
- Never promise unrealistic timelines (max safe fat loss: 0.5-1kg/week)
- Always include warm-up and cool-down in workout plans
- Consider injuries and medical conditions — modify exercises accordingly
- Use progressive overload principles
- Output valid JSON only

FORMAT your response as a JSON object with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "notes": ""
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": ""
  },
  "weekly_focus": "...",
  "coach_note": "..."
}`;

    const userPrompt = buildUserPrompt(client, intake, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy({
        reason: 'Program generation failed — invalid JSON from Claude',
        phone: client.phone,
        details: `Client: ${maskPhone(client.phone)}, Week: ${week_no}`
      });
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const lowerText = rawText.toLowerCase();
    const hasSafetyIssue = SAFETY_FLAGS.some(flag => lowerText.includes(flag));
    if (hasSafetyIssue) {
      await escalateToMaddy({
        reason: 'Safety flag in generated program — halted auto-send',
        phone: client.phone,
        details: `Week ${week_no}: Program flagged for review before sending`
      });

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'FLAGGED: Requires Maddy review before sending',
        pdf_url: null
      });

      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }

    const pdfContent = generatePdfHtml(client, programData, week_no);
    const pdfBlob = new Blob([pdfContent], { type: 'text/html' });
    const pdfPath = `clients/${client.id}/week_${week_no}.html`;

    await db.storage.from('clients').upload(pdfPath, pdfBlob, { upsert: true });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note,
      pdf_url: pdfUrl,
      whatsapp_sent_at: new Date().toISOString()
    });

    if (progErr) {
      console.error('Program insert error:', progErr.message);
    }

    const market = detectMarket(client.phone);
    const hinglish = isHinglishMarket(market);
    const weekMsg = hinglish
      ? `Week ${week_no} ka program ready hai! Focus: ${programData.weekly_focus}. Check karein: ${pdfUrl}`
      : `Your Week ${week_no} program is ready! Focus: ${programData.weekly_focus}. View it here: ${pdfUrl}`;

    await sendWhatsAppDirect({
      phone: client.phone,
      templateName: 'weekly_program',
      body: weekMsg,
      params: [client.name || 'there', String(week_no), programData.weekly_focus]
    });

    return res.status(200).json({
      action: 'program_generated',
      client_id,
      week_no,
      phone: maskPhone(client.phone)
    });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'Unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'Unknown'}\n`;
    prompt += `Height: ${intake.height_cm || 'Unknown'}cm\n`;
    prompt += `Current Weight: ${intake.weight_kg || 'Unknown'}kg\n`;
    prompt += `Goal: ${intake.goal || 'General fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'None'}\n`;
    prompt += `Medical: ${intake.medical_conditions || 'None'}\n`;
    prompt += `Diet Preference: ${intake.diet_preference || 'No preference'}\n`;
    prompt += `Days/week: ${intake.workout_days_per_week || 5}\n`;
    prompt += `Equipment: ${intake.equipment_access || 'Full gym'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      if (c.next_week_focus) prompt += `, Focus: ${c.next_week_focus}`;
      prompt += '\n';
    }
  }

  if (weekNo > 1) {
    prompt += `\nThis is week ${weekNo} of ${client.program === '12wk' ? 12 : 6}. Apply progressive overload from the previous week.`;
  }

  return prompt;
}

function generatePdfHtml(client, program, weekNo) {
  const workoutRows = (program.workout_plan?.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets} x ${ex.reps}</td><td>${ex.rest}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.day} — ${day.focus}</h3>
        <table>
          <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
      </div>`;
  }).join('');

  const mealRows = (program.nutrition_plan?.meals || []).map(m =>
    `<div class="meal"><strong>${m.meal} (${m.time})</strong><ul>${(m.options || []).map(o => `<li>${o}</li>`).join('')}</ul></div>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; background:#111; color:#fff; padding:40px 24px; }
  .header { text-align:center; margin-bottom:40px; border-bottom:2px solid #B8965A; padding-bottom:24px; }
  .header h1 { font-family:'Bebas Neue',sans-serif; font-size:48px; color:#B8965A; letter-spacing:4px; }
  .header h2 { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#fff; letter-spacing:2px; margin-top:8px; }
  .header p { color:#888; font-size:14px; margin-top:8px; }
  .section-title { font-family:'Bebas Neue',sans-serif; font-size:32px; color:#B8965A; letter-spacing:2px; margin:32px 0 16px; }
  .day-block { background:#1a1a1a; border-radius:8px; padding:20px; margin-bottom:16px; }
  .day-block h3 { font-family:'Bebas Neue',sans-serif; font-size:22px; color:#B8965A; margin-bottom:12px; letter-spacing:1px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:#888; padding:8px; border-bottom:1px solid #333; }
  td { padding:10px 8px; border-bottom:1px solid #222; font-size:14px; color:#ccc; }
  .macros { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:16px 0; }
  .macro-box { background:#1a1a1a; border-radius:8px; padding:20px; text-align:center; }
  .macro-box .num { font-family:'Bebas Neue',sans-serif; font-size:36px; color:#B8965A; }
  .macro-box .label { font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-top:4px; }
  .meal { background:#1a1a1a; border-radius:8px; padding:16px 20px; margin-bottom:12px; }
  .meal strong { color:#B8965A; }
  .meal ul { margin-top:8px; padding-left:20px; color:#ccc; font-size:14px; }
  .meal li { margin-bottom:4px; }
  .focus-box { background:linear-gradient(135deg,#B8965A,#8B6914); border-radius:8px; padding:24px; margin:24px 0; text-align:center; }
  .focus-box p { font-size:18px; font-weight:600; color:#111; }
  .coach-note { background:#1a1a1a; border-left:3px solid #B8965A; padding:16px 20px; margin:24px 0; border-radius:0 8px 8px 0; }
  .coach-note p { color:#ccc; font-size:14px; line-height:1.7; }
  .footer { text-align:center; margin-top:40px; padding-top:24px; border-top:1px solid #333; }
  .footer p { color:#555; font-size:12px; }
</style></head><body>
  <div class="header">
    <h1>Fitness by Maddy</h1>
    <h2>Week ${weekNo} Program</h2>
    <p>${client.name || 'Client'} | ${client.program}</p>
  </div>

  ${program.weekly_focus ? `<div class="focus-box"><p>This Week's Focus: ${program.weekly_focus}</p></div>` : ''}

  <div class="section-title">Workout Plan</div>
  ${workoutRows}

  <div class="section-title">Nutrition Plan</div>
  <div class="macros">
    <div class="macro-box"><div class="num">${program.nutrition_plan?.calories || '—'}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="num">${program.nutrition_plan?.protein_g || '—'}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="num">${program.nutrition_plan?.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="num">${program.nutrition_plan?.fat_g || '—'}g</div><div class="label">Fat</div></div>
  </div>
  ${mealRows}

  ${program.coach_note ? `<div class="coach-note"><p><strong>Coach's Note:</strong> ${program.coach_note}</p></div>` : ''}

  <div class="footer"><p>Fitness by Maddy | fitnessbymaddy.com</p></div>
</body></html>`;
}
