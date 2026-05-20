const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask-phone');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'clenbuterol', 'dnp', 'dinitrophenol', 'sarm', 'steroid',
  'ephedra', 'banned substance',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], intakeForm, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: `You are a certified fitness program architect for Fitness by Maddy. Create safe, science-backed, personalised weekly workout and nutrition plans. Output valid JSON only. Never recommend banned substances, extreme calorie restriction (below 1200 for women, 1500 for men), or unrealistic timelines. Always prioritise client safety.`,
    });

    const content = response.content[0].text;

    const safetyCheck = SAFETY_FLAGS.some(flag =>
      content.toLowerCase().includes(flag)
    );

    if (safetyCheck) {
      await sendWhatsApp({
        phone: '+917082478374',
        templateName: 'escalation_alert',
        body: `⚠️ PROGRAM SAFETY FLAG\nClient: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nThe generated program contains potentially unsafe content. Review required before sending.`,
      });

      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: {},
        nutrition_plan: {},
        notes: 'FLAGGED: Safety review required',
      });

      return res.status(200).json({ action: 'flagged_for_review' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = { raw: content, workout_plan: {}, nutrition_plan: {} };
    }

    const workoutPlan = parsed.workout_plan || parsed.workouts || {};
    const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    const notes = parsed.notes || parsed.context_note || '';

    const pdfHtml = buildPdfHtml(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfFileName = `clients/${client_id}/week_${week_no}.pdf`;

    await db.storage.from('client-files').upload(
      `${pdfFileName}.html`,
      Buffer.from(pdfHtml),
      { contentType: 'text/html', upsert: true }
    );

    const { data: pdfUrl } = db.storage
      .from('client-files')
      .getPublicUrl(`${pdfFileName}.html`);

    const { error: programErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl.publicUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
    });

    if (programErr) {
      console.error('Program insert error:', programErr.message);
    }

    const contextNote = notes || `Here's your Week ${week_no} program — let's keep pushing! 💪`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: `${contextNote}\n\nYour Week ${week_no} plan: ${pdfUrl.publicUrl}`,
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let prompt = `Generate a Week ${weekNo} personalised fitness program for this client.\n\n`;
  prompt += `CLIENT PROFILE:\n`;
  prompt += `Name: ${client.name}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'Unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'Unknown'}\n`;
    prompt += `Goal: ${intake.goal || 'General fitness'}\n`;
    prompt += `Experience: ${intake.experience_level || 'Unknown'}\n`;
    prompt += `Injuries: ${intake.injuries || 'None reported'}\n`;
    prompt += `Diet preference: ${intake.diet_preference || 'No preference'}\n`;
    prompt += `Schedule: ${intake.schedule || 'Flexible'}\n`;
    prompt += `Current weight: ${intake.current_weight || 'Unknown'}kg\n`;
    prompt += `Target weight: ${intake.target_weight || 'Not set'}kg\n`;
    prompt += `Medical conditions: ${intake.medical_conditions || 'None'}\n`;
  }

  if (lastCheckin) {
    prompt += `\nLAST CHECK-IN (Week ${lastCheckin.week_no}):\n`;
    prompt += `Weight: ${lastCheckin.weight || 'N/A'}kg\n`;
    prompt += `Waist: ${lastCheckin.waist || 'N/A'}cm\n`;
    prompt += `Compliance: ${lastCheckin.compliance_score}/10\n`;
    prompt += `Energy: ${lastCheckin.energy}/10\n`;
    prompt += `Issues: ${lastCheckin.issues || 'None'}\n`;
    if (lastCheckin.next_week_focus) {
      prompt += `Focus area: ${lastCheckin.next_week_focus}\n`;
    }
  }

  if (prevCheckin) {
    prompt += `\nPREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):\n`;
    prompt += `Weight: ${prevCheckin.weight || 'N/A'}kg | Compliance: ${prevCheckin.compliance_score}/10\n`;
  }

  prompt += `\nOutput a JSON object with these keys:\n`;
  prompt += `- workout_plan: { day1: { name, exercises: [{ name, sets, reps, rest, notes }] }, ... }\n`;
  prompt += `- nutrition_plan: { calories, protein_g, carbs_g, fat_g, meals: [{ name, foods, notes }] }\n`;
  prompt += `- notes: A 1-2 sentence context note for the client about this week's focus\n`;
  prompt += `\nReturn ONLY valid JSON, no markdown.`;

  return prompt;
}

function buildPdfHtml(client, weekNo, workout, nutrition, notes) {
  const days = Object.entries(workout);

  let workoutHtml = '';
  for (const [day, data] of days) {
    const dayData = typeof data === 'object' ? data : { name: day, exercises: [] };
    workoutHtml += `<div class="day-block">
      <h3>${dayData.name || day}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>
        ${(dayData.exercises || []).map(ex => `
          <tr>
            <td>${ex.name || ''}</td>
            <td>${ex.sets || ''}</td>
            <td>${ex.reps || ''}</td>
            <td>${ex.rest || ''}</td>
            <td>${ex.notes || ''}</td>
          </tr>
        `).join('')}
      </table>
    </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #111; color: #fff; padding: 40px; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .context-note { background: #1a1a1a; border-left: 3px solid #B8965A; padding: 16px 20px; margin-bottom: 32px; font-size: 15px; color: #ccc; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; }
  .day-block { background: #1a1a1a; padding: 24px; border-radius: 4px; margin-bottom: 16px; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #B8965A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; background: #222; color: #B8965A; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  td { padding: 8px 12px; border-bottom: 1px solid #222; font-size: 13px; color: #ddd; }
  .nutrition { background: #1a1a1a; padding: 24px; border-radius: 4px; }
  .macros { display: flex; gap: 24px; margin: 16px 0; }
  .macro { text-align: center; flex: 1; }
  .macro-val { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .meal { padding: 12px 0; border-bottom: 1px solid #222; }
  .meal-name { font-weight: 600; color: #B8965A; font-size: 14px; }
  .meal-foods { font-size: 13px; color: #ccc; margin-top: 4px; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; color: #555; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name} | ${client.program?.toUpperCase()}</p>
  </div>

  ${notes ? `<div class="context-note">${notes}</div>` : ''}

  <div class="section-title">WORKOUT PLAN</div>
  ${workoutHtml}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition">
    <div class="macros">
      <div class="macro"><div class="macro-val">${nutrition.calories || '—'}</div><div class="macro-label">Calories</div></div>
      <div class="macro"><div class="macro-val">${nutrition.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
      <div class="macro"><div class="macro-val">${nutrition.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
      <div class="macro"><div class="macro-val">${nutrition.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
    </div>
    ${(nutrition.meals || []).map(meal => `
      <div class="meal">
        <div class="meal-name">${meal.name || ''}</div>
        <div class="meal-foods">${Array.isArray(meal.foods) ? meal.foods.join(', ') : (meal.foods || '')}</div>
        ${meal.notes ? `<div class="meal-foods" style="color:#888; font-style:italic;">${meal.notes}</div>` : ''}
      </div>
    `).join('')}
  </div>

  <div class="footer">
    FITNESS BY MADDY &copy; ${new Date().getFullYear()} | This program is personalised — do not share.
  </div>
</body>
</html>`;
}
