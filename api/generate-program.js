const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'crash diet',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'very low calorie',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: intakeFiles } = await db.storage
      .from('client-files')
      .list(`intakes/${client.lead_id || client_id}`);

    let intakeData = null;
    if (intakeFiles && intakeFiles.length > 0) {
      const latest = intakeFiles[intakeFiles.length - 1];
      const { data: fileData } = await db.storage
        .from('client-files')
        .download(`intakes/${client.lead_id || client_id}/${latest.name}`);
      if (fileData) {
        intakeData = JSON.parse(await fileData.text());
      }
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect. You create personalised weekly workout and nutrition plans for fitness coaching clients.

RULES:
- Plans must be safe, evidence-based, and appropriate for the client's level
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Use progressive overload principles
- Factor in client's injuries, medical conditions, and preferences
- Output valid JSON only with two keys: "workout_plan" and "nutrition_plan"
- Each workout day should have: day, focus, exercises (array with name, sets, reps, rest)
- Nutrition plan should have: daily_calories, protein_g, carbs_g, fat_g, meal_timing (array), notes`;

    const userPrompt = buildPrompt(client, recentCheckins, intakeData, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy('Program generation failed - no JSON', client.phone, 'Claude returned non-JSON');
      return res.status(500).json({ error: 'Invalid program output' });
    }

    const program = JSON.parse(jsonMatch[0]);
    const programStr = JSON.stringify(program).toLowerCase();

    const hasSafetyIssue = SAFETY_FLAGS.some(flag => programStr.includes(flag));
    if (hasSafetyIssue) {
      await escalateToMaddy(
        'Program flagged for safety review',
        client.phone,
        `Week ${week_no} program contains potentially unsafe content`
      );
      return res.status(200).json({ flagged: true, reason: 'safety_review' });
    }

    const pdfHtml = renderProgramPDF(client, program, week_no);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, { contentType: 'text/html', upsert: true });

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: `Auto-generated for week ${week_no}`,
    });

    if (insertError) {
      return res.status(500).json({ error: 'Failed to store program' });
    }

    const market = detectMarket(client.phone);
    const template = isHinglish(market) ? 'weekly_program_hi' : 'weekly_program';

    await sendWhatsApp(client.phone, template, [
      client.name || 'there',
      `Week ${week_no}`,
    ], pdfUrl);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  let prompt = `Generate Week ${weekNo} program for client:\n`;
  prompt += `- Name: ${client.name || 'Unknown'}\n`;
  prompt += `- Program: ${client.program}\n`;

  if (intake) {
    prompt += `- Age: ${intake.age || 'N/A'}, Gender: ${intake.gender || 'N/A'}\n`;
    prompt += `- Height: ${intake.height || 'N/A'}, Starting Weight: ${intake.weight || 'N/A'}\n`;
    prompt += `- Goal: ${intake.goal || 'General fitness'}\n`;
    prompt += `- Injuries: ${intake.injuries || 'None reported'}\n`;
    prompt += `- Diet Preference: ${intake.diet_pref || 'No preference'}\n`;
    prompt += `- Schedule: ${intake.schedule || 'Flexible'}\n`;
    prompt += `- Experience: ${intake.experience || 'Intermediate'}\n`;
    prompt += `- Medical: ${intake.medical_conditions || 'None'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += '\nRecent check-in data:\n';
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, `;
      prompt += `Waist ${c.waist || 'N/A'}cm, `;
      prompt += `Compliance ${c.compliance_score || 'N/A'}/10, `;
      prompt += `Energy ${c.energy || 'N/A'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      if (c.next_week_focus) prompt += `, Focus: ${c.next_week_focus}`;
      prompt += '\n';
    }
  }

  prompt += '\nReturn ONLY valid JSON.';
  return prompt;
}

function renderProgramPDF(client, program, weekNo) {
  const workout = program.workout_plan || [];
  const nutrition = program.nutrition_plan || {};

  let workoutHtml = '';
  const days = Array.isArray(workout) ? workout : [];
  for (const day of days) {
    workoutHtml += `<div class="day-card">
      <h3>${day.day || ''} — ${day.focus || ''}</h3>
      <table><thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr></thead><tbody>`;
    const exercises = day.exercises || [];
    for (const ex of exercises) {
      workoutHtml += `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest}</td></tr>`;
    }
    workoutHtml += '</tbody></table></div>';
  }

  const meals = (nutrition.meal_timing || []).map(m =>
    `<li><strong>${m.time || m.meal || ''}</strong>: ${m.description || m.foods || ''}</li>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #0a0a0a; color: #fff; padding: 40px; }
  h1, h2, h3 { font-family: 'Bebas Neue', sans-serif; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 32px; }
  .header h1 { font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-size: 28px; color: #B8965A; margin: 32px 0 16px; letter-spacing: 2px; }
  .day-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
  .day-card h3 { color: #B8965A; font-size: 20px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px; color: #B8965A; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid #333; }
  td { padding: 8px; color: #ccc; font-size: 14px; border-bottom: 1px solid #1f1f1f; }
  .nutrition-box { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 24px; }
  .macros { display: flex; gap: 24px; margin: 16px 0; }
  .macro { text-align: center; flex: 1; }
  .macro-num { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  ul { list-style: none; padding: 0; }
  li { padding: 8px 0; border-bottom: 1px solid #1f1f1f; color: #ccc; font-size: 14px; }
  .footer { text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid #333; color: #555; font-size: 12px; }
</style></head><body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <p>${client.name || 'Client'} &mdash; Week ${weekNo} Program</p>
  </div>
  <h2 class="section-title">WORKOUT PLAN</h2>
  ${workoutHtml}
  <h2 class="section-title">NUTRITION PLAN</h2>
  <div class="nutrition-box">
    <div class="macros">
      <div class="macro"><div class="macro-num">${nutrition.daily_calories || '—'}</div><div class="macro-label">Calories</div></div>
      <div class="macro"><div class="macro-num">${nutrition.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
      <div class="macro"><div class="macro-num">${nutrition.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
      <div class="macro"><div class="macro-num">${nutrition.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
    </div>
    ${nutrition.notes ? `<p style="color:#aaa; margin: 16px 0; font-size:14px;">${nutrition.notes}</p>` : ''}
    <ul>${meals}</ul>
  </div>
  <div class="footer">FITNESS BY MADDY &copy; ${new Date().getFullYear()} &mdash; This program is personalised. Do not share.</div>
</body></html>`;
}
