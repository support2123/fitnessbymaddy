const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { programLabel } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'starvation', 'clenbuterol', 'dnp', 'ephedra', 'steroid',
  'anabolic', 'sarm', 'hgh', 'growth hormone',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: intake } = await db
      .from('intake_forms')
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

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect working for FitnessByMaddy.
You create safe, evidence-based, personalized weekly workout and nutrition plans.

RULES:
- Never prescribe banned substances or supplements without FDA approval
- Minimum 1200 calories/day for women, 1500 for men
- Never promise specific weight loss timelines
- Include rest days (minimum 1-2 per week)
- Progressive overload principles
- Consider injuries and medical conditions
- Output valid JSON only

OUTPUT FORMAT:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "cardio": {"type": "LISS", "duration": "20 min"},
        "warmup": "5 min dynamic stretching"
      }
    ],
    "rest_days": ["Sunday"],
    "notes": ""
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      {"meal": "Breakfast", "options": ["Option 1", "Option 2"]},
      {"meal": "Lunch", "options": ["Option 1", "Option 2"]},
      {"meal": "Dinner", "options": ["Option 1", "Option 2"]},
      {"meal": "Snacks", "options": ["Option 1", "Option 2"]}
    ],
    "hydration": "3-4 liters/day",
    "supplements": ["Whey protein", "Creatine 5g/day", "Vitamin D"],
    "notes": ""
  },
  "coach_notes": "Brief message to the client about this week's focus"
}`;

    const userPrompt = buildPrompt(client, intake, recentCheckins, prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawOutput = response.content[0].text;

    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from Claude response');
    }

    const programData = JSON.parse(jsonMatch[0]);

    const outputStr = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => outputStr.includes(flag));

    if (flagged) {
      await db.from('escalations').insert({
        phone: client.phone,
        client_id,
        reason: 'unsafe_program_content',
        message: `Week ${week_no} program flagged for safety review`,
        status: 'pending',
      });

      const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
      await sendWhatsApp(maddyPhone, 'escalation_alert', [
        `PROGRAM SAFETY FLAG: Week ${week_no} for ${client.name || maskPhone(client.phone)} was flagged. Review before sending.`,
      ]);

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: `FLAGGED: ${programData.coach_notes || ''}`,
      });

      return res.status(200).json({ success: true, flagged: true });
    }

    const pdfHtml = renderProgramPdf(programData, client, week_no);
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, Buffer.from(pdfHtml), {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData.publicUrl;

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || null,
    });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
    }

    const sendMsg = programData.coach_notes
      ? `Your Week ${week_no} program is ready! ${programData.coach_notes}\n\nView: ${pdfUrl}`
      : `Your Week ${week_no} program is ready!\n\nView: ${pdfUrl}`;

    await sendWhatsApp(client.phone, 'weekly_program', [sendMsg]);
    await logMessage(client.phone, 'out', sendMsg, 'weekly_program');

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(client, intake, checkins, prevProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;

  prompt += `CLIENT PROFILE:\n`;
  prompt += `- Name: ${client.name || 'Unknown'}\n`;
  prompt += `- Program: ${programLabel(client.program)}\n`;
  prompt += `- Started: ${client.program_started_at}\n`;

  if (intake) {
    prompt += `\nINTAKE DATA:\n`;
    prompt += `- Age: ${intake.age || 'unknown'}, Gender: ${intake.gender || 'unknown'}\n`;
    prompt += `- Goal: ${intake.goal || 'general fitness'}\n`;
    prompt += `- Current weight: ${intake.current_weight || 'unknown'}kg\n`;
    prompt += `- Target weight: ${intake.target_weight || 'unknown'}kg\n`;
    prompt += `- Height: ${intake.height || 'unknown'}cm\n`;
    prompt += `- Injuries: ${intake.injuries || 'none reported'}\n`;
    prompt += `- Medical conditions: ${intake.medical_conditions || 'none reported'}\n`;
    prompt += `- Diet preference: ${intake.diet_preference || 'no preference'}\n`;
    prompt += `- Experience: ${intake.training_experience || 'unknown'}\n`;
    prompt += `- Equipment: ${intake.available_equipment || 'full gym'}\n`;
    prompt += `- Schedule: ${intake.weekly_schedule || 'flexible'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRECENT CHECK-INS:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, `;
      prompt += `Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10\n`;
      if (c.issues) prompt += `  Issues: ${c.issues}\n`;
      if (c.next_week_focus) prompt += `  Focus: ${c.next_week_focus}\n`;
    }
  }

  if (prevProgram) {
    prompt += `\nPREVIOUS WEEK PROGRAM SUMMARY:\n`;
    prompt += JSON.stringify(prevProgram, null, 2).substring(0, 1000);
  }

  prompt += `\n\nGenerate the Week ${weekNo} program. Adjust based on check-in data if available. Output JSON only.`;

  return prompt;
}

function renderProgramPdf(programData, client, weekNo) {
  const { workout_plan, nutrition_plan, coach_notes } = programData;

  let workoutHtml = '';
  if (workout_plan && workout_plan.days) {
    for (const day of workout_plan.days) {
      workoutHtml += `<div class="day-block">
        <h3>${day.day} — ${day.focus}</h3>
        ${day.warmup ? `<p class="warmup">Warmup: ${day.warmup}</p>` : ''}
        <table>
          <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>
          ${(day.exercises || []).map(e =>
            `<tr><td>${e.name}</td><td>${e.sets}</td><td>${e.reps}</td><td>${e.rest}</td><td>${e.notes || ''}</td></tr>`
          ).join('')}
        </table>
        ${day.cardio ? `<p class="cardio">Cardio: ${day.cardio.type} — ${day.cardio.duration}</p>` : ''}
      </div>`;
    }
  }

  let nutritionHtml = '';
  if (nutrition_plan) {
    nutritionHtml = `<div class="nutrition-block">
      <div class="macros">
        <div class="macro"><span>${nutrition_plan.calories}</span>Calories</div>
        <div class="macro"><span>${nutrition_plan.protein_g}g</span>Protein</div>
        <div class="macro"><span>${nutrition_plan.carbs_g}g</span>Carbs</div>
        <div class="macro"><span>${nutrition_plan.fat_g}g</span>Fat</div>
      </div>
      ${(nutrition_plan.meals || []).map(m =>
        `<div class="meal">
          <h4>${m.meal}</h4>
          <ul>${(m.options || []).map(o => `<li>${o}</li>`).join('')}</ul>
        </div>`
      ).join('')}
      ${nutrition_plan.supplements ? `<p class="supplements">Supplements: ${nutrition_plan.supplements.join(', ')}</p>` : ''}
      ${nutrition_plan.hydration ? `<p class="hydration">Hydration: ${nutrition_plan.hydration}</p>` : ''}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Week ${weekNo} Program — Fitness by Maddy</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'DM Sans', sans-serif; background: #111; color: #fff; padding: 0; }
    .header { background: linear-gradient(135deg, #1a1a1a, #111); padding: 48px 40px; border-bottom: 3px solid #B8965A; }
    .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
    .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
    .header p { color: rgba(255,255,255,0.5); font-size: 14px; margin-top: 12px; }
    .coach-note { background: #1a1a1a; border-left: 4px solid #B8965A; padding: 24px 32px; margin: 32px 40px; font-style: italic; color: rgba(255,255,255,0.8); line-height: 1.6; }
    .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; padding: 32px 40px 16px; letter-spacing: 3px; }
    .day-block { margin: 0 40px 32px; background: #1a1a1a; border-radius: 4px; padding: 24px; }
    .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #B8965A; letter-spacing: 2px; margin-bottom: 16px; }
    .warmup, .cardio { font-size: 13px; color: rgba(255,255,255,0.6); margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th { text-align: left; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #B8965A; padding: 8px 12px; border-bottom: 1px solid #333; }
    td { font-size: 14px; padding: 10px 12px; border-bottom: 1px solid #222; color: rgba(255,255,255,0.85); }
    .nutrition-block { margin: 0 40px 32px; }
    .macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .macro { background: #1a1a1a; padding: 20px; text-align: center; border-radius: 4px; border: 1px solid #333; }
    .macro span { display: block; font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
    .meal { background: #1a1a1a; padding: 20px; margin-bottom: 12px; border-radius: 4px; }
    .meal h4 { font-family: 'Bebas Neue', sans-serif; font-size: 18px; color: #B8965A; letter-spacing: 1px; margin-bottom: 8px; }
    .meal ul { list-style: none; }
    .meal li { padding: 4px 0; font-size: 14px; color: rgba(255,255,255,0.8); }
    .meal li::before { content: '→ '; color: #B8965A; }
    .supplements, .hydration { font-size: 13px; color: rgba(255,255,255,0.6); margin: 8px 40px; }
    .footer { text-align: center; padding: 40px; border-top: 1px solid #333; margin-top: 40px; }
    .footer p { color: rgba(255,255,255,0.3); font-size: 12px; letter-spacing: 1px; }
    @media print { body { background: white; color: #111; } .header { background: #111; } }
    @media (max-width: 600px) { .macros { grid-template-columns: repeat(2, 1fr); } .header, .section-title, .day-block, .nutrition-block { padding-left: 20px; padding-right: 20px; } .coach-note { margin: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name || 'Client'} · ${programLabel(client.program)}</p>
  </div>
  ${coach_notes ? `<div class="coach-note">"${coach_notes}"</div>` : ''}
  <div class="section-title">WORKOUT PLAN</div>
  ${workoutHtml}
  <div class="section-title">NUTRITION PLAN</div>
  ${nutritionHtml}
  <div class="footer">
    <p>FITNESS BY MADDY · CUSTOM PROGRAM · CONFIDENTIAL</p>
  </div>
</body>
</html>`;
}
