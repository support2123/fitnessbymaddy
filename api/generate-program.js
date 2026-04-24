const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const SAFETY_FLAGS = [
  'below 1000 calorie', 'under 800 calorie', '500 calorie',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in',
  'extreme fasting', 'zero carb for', 'water fast',
];

function checkProgramSafety(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) {
      return { safe: false, flag };
    }
  }
  return { safe: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: previousProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
    }));

    const prompt = `You are a certified fitness coach creating a personalized weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
- Program started: ${client.program_started_at}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

${previousProgram ? `PREVIOUS WEEK PLAN NOTES: ${previousProgram.notes || 'None'}` : 'This is the first week.'}

Generate a complete weekly program with:
1. workout_plan: 5-6 days of training (JSON with day, exercises, sets, reps, rest)
2. nutrition_plan: daily calorie target, macro split, meal timing, sample meals (JSON)
3. notes: 1-2 sentence coaching note for the client

Rules:
- Progressive overload from previous week if available
- Realistic calorie targets (minimum 1200 for women, 1500 for men)
- No banned substances or extreme protocols
- Adapt based on compliance score and energy levels
- If issues reported, modify accordingly

Return ONLY valid JSON with keys: workout_plan, nutrition_plan, notes`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawOutput = response.content[0].text;

    const safety = checkProgramSafety(rawOutput);
    if (!safety.safe) {
      await notifyMaddy(
        'Program Safety Flag',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nFlag: ${safety.flag}\n\nProgram halted for review.`
      );
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        flag: safety.flag,
      });
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch (e) {
      console.error('Failed to parse program JSON:', e.message);
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.notes,
        pdf_url: null,
      })
      .select()
      .single();

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const programHtml = renderProgramHtml(client, week_no, parsed);
    const htmlBuffer = Buffer.from(programHtml, 'utf-8');
    const filePath = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage
      .from('client-files')
      .upload(filePath, htmlBuffer, {
        contentType: 'text/html',
        upsert: true,
      });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await supabase
      .from('programs')
      .update({ pdf_url: pdfUrl })
      .eq('id', program.id);

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        week_no.toString(),
        parsed.notes || 'New week, new gains!',
      ],
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function renderProgramHtml(client, weekNo, plan) {
  const workoutRows = (plan.workout_plan || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name || ex.exercise || ''}</td>
        <td>${ex.sets || ''}</td>
        <td>${ex.reps || ''}</td>
        <td>${ex.rest || ''}</td>
      </tr>`
    ).join('');
    return `<div class="day-block">
      <h3>${day.day || ''}</h3>
      <table>
        <thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr></thead>
        <tbody>${exercises}</tbody>
      </table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Week ${weekNo} Program - ${client.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #faf8f4; padding: 40px 24px; }
    .header { text-align: center; margin-bottom: 48px; border-bottom: 2px solid #B8965A; padding-bottom: 32px; }
    .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
    .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #faf8f4; letter-spacing: 2px; margin-top: 8px; }
    .header p { color: #999; font-size: 14px; margin-top: 8px; }
    .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 3px; margin: 40px 0 20px; }
    .day-block { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 20px; border-left: 3px solid #B8965A; }
    .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #D4AF7A; margin-bottom: 16px; letter-spacing: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 12px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #999; border-bottom: 1px solid #333; }
    td { padding: 10px 12px; font-size: 14px; border-bottom: 1px solid #2a2a2a; }
    .nutrition { background: #222; border-radius: 8px; padding: 32px; border-left: 3px solid #B8965A; }
    .nutrition p { margin-bottom: 8px; font-size: 15px; line-height: 1.6; }
    .nutrition strong { color: #D4AF7A; }
    .coach-note { background: linear-gradient(135deg, #2C2C2C, #1a1a1a); border: 1px solid #B8965A; border-radius: 8px; padding: 24px; margin-top: 40px; text-align: center; }
    .coach-note p { font-style: italic; color: #D4AF7A; font-size: 16px; }
    .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #333; }
    .footer p { color: #666; font-size: 12px; letter-spacing: 1px; }
    @media print { body { background: white; color: #1a1a1a; } .day-block, .nutrition { background: #f5f5f5; border-left-color: #B8965A; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name} &middot; ${client.program?.toUpperCase() || ''}</p>
  </div>
  <div class="section-title">WORKOUT PLAN</div>
  ${workoutRows}
  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition">
    <p><strong>Calories:</strong> ${plan.nutrition_plan?.calories || plan.nutrition_plan?.daily_calories || 'As prescribed'}</p>
    <p><strong>Protein:</strong> ${plan.nutrition_plan?.protein || plan.nutrition_plan?.macros?.protein || '--'}g</p>
    <p><strong>Carbs:</strong> ${plan.nutrition_plan?.carbs || plan.nutrition_plan?.macros?.carbs || '--'}g</p>
    <p><strong>Fats:</strong> ${plan.nutrition_plan?.fats || plan.nutrition_plan?.macros?.fats || '--'}g</p>
    ${plan.nutrition_plan?.meal_timing ? `<p><strong>Meal Timing:</strong> ${plan.nutrition_plan.meal_timing}</p>` : ''}
    ${plan.nutrition_plan?.notes ? `<p><strong>Notes:</strong> ${plan.nutrition_plan.notes}</p>` : ''}
  </div>
  ${plan.notes ? `<div class="coach-note"><p>"${plan.notes}"</p><p style="color:#666; font-size:12px; margin-top:12px;">— Coach Maddy</p></div>` : ''}
  <div class="footer">
    <p>FITNESS BY MADDY &middot; CONFIDENTIAL &middot; DO NOT SHARE</p>
  </div>
</body>
</html>`;
}
