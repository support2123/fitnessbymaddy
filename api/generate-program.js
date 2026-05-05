const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');

const SYSTEM_PROMPT = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Generate a weekly training + nutrition plan based on client data.

Rules:
- Never recommend extreme calorie cuts (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines (>1kg/week fat loss)
- Adjust based on compliance score and energy levels from check-ins
- Include progressive overload principles
- Account for injuries and limitations

Output format: JSON with "workout_plan" and "nutrition_plan" keys.
workout_plan: array of 7 days, each with exercises (name, sets, reps, rest, notes)
nutrition_plan: object with daily_calories, protein_g, carbs_g, fats_g, meal_timing, sample_meals[]`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  // Get client profile
  const { data: client } = await supabase
    .from('clients')
    .select('*, leads(intake_data, market)')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  // Get last 2 check-ins
  const { data: checkins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  // Build prompt
  const clientContext = {
    name: client.name,
    program: client.program,
    week: week_no,
    intake: client.leads?.intake_data || {},
    recent_checkins: checkins || [],
  };

  const anthropic = new Anthropic();

  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n${JSON.stringify(clientContext, null, 2)}`,
      }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Program generation failed', detail: e.message });
  }

  // Safety check
  if (programData.nutrition_plan) {
    const cals = programData.nutrition_plan.daily_calories;
    if (cals && cals < 1200) {
      await escalateToMaddy({
        reason: 'Generated program has dangerously low calories',
        phone: client.phone,
        context: `Week ${week_no}: ${cals} kcal suggested`,
      });
      return res.status(200).json({ flagged: true, reason: 'Low calorie plan needs review' });
    }
  }

  // Generate simple HTML-based PDF content (stored as HTML for now)
  const pdfHtml = generateProgramPdf(client, week_no, programData);
  const pdfBuffer = Buffer.from(pdfHtml);
  const pdfPath = `${client_id}/week_${week_no}.html`;

  // Upload to Supabase Storage
  await supabase.storage
    .from('clients')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

  const { data: urlData } = supabase.storage
    .from('clients')
    .getPublicUrl(pdfPath);

  const pdfUrl = urlData?.publicUrl || '';

  // Save to programs table
  const { data: program } = await supabase
    .from('programs')
    .insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || null,
    })
    .select()
    .single();

  // Send via WhatsApp
  const market = client.leads?.market || 'GLOBAL';
  const contextNote = market === 'IN'
    ? `Week ${week_no} ka plan ready hai! 💪 Check karo aur questions ho toh batao.`
    : `Your Week ${week_no} plan is ready! 💪 Check it out and let me know if you have questions.`;

  await sendWhatsApp({
    phone: client.phone,
    templateName: 'weekly_program',
    params: [contextNote, pdfUrl],
    mediaUrl: pdfUrl,
  });

  // Update sent timestamp
  if (program) {
    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);
  }

  return res.status(200).json({ success: true, program_id: program?.id, pdf_url: pdfUrl });
};

function generateProgramPdf(client, weekNo, data) {
  const { workout_plan, nutrition_plan } = data;

  let workoutHtml = '';
  if (Array.isArray(workout_plan)) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    workout_plan.forEach((day, i) => {
      workoutHtml += `<div class="day"><h3>${days[i] || `Day ${i + 1}`}</h3>`;
      if (day.rest) {
        workoutHtml += `<p class="rest">Rest Day</p>`;
      } else if (Array.isArray(day.exercises)) {
        workoutHtml += '<table><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr>';
        day.exercises.forEach(ex => {
          workoutHtml += `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest || '60s'}</td></tr>`;
        });
        workoutHtml += '</table>';
        if (day.notes) workoutHtml += `<p class="notes">${day.notes}</p>`;
      }
      workoutHtml += '</div>';
    });
  }

  let nutritionHtml = '';
  if (nutrition_plan) {
    nutritionHtml = `
      <div class="macros">
        <div class="macro"><span>${nutrition_plan.daily_calories || '—'}</span>kcal</div>
        <div class="macro"><span>${nutrition_plan.protein_g || '—'}g</span>Protein</div>
        <div class="macro"><span>${nutrition_plan.carbs_g || '—'}g</span>Carbs</div>
        <div class="macro"><span>${nutrition_plan.fats_g || '—'}g</span>Fats</div>
      </div>`;
    if (Array.isArray(nutrition_plan.sample_meals)) {
      nutritionHtml += '<h3>Sample Meals</h3><ul>';
      nutrition_plan.sample_meals.forEach(meal => {
        nutritionHtml += `<li><strong>${meal.name || meal.time || ''}</strong>: ${meal.description || meal.items || ''}</li>`;
      });
      nutritionHtml += '</ul>';
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Week ${weekNo} Program - ${client.name || 'Client'}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', Arial, sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
  .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #B8965A; padding-bottom: 24px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; letter-spacing: 3px; }
  .header h2 { font-size: 18px; font-weight: 300; color: #ccc; margin-top: 8px; }
  .section { margin-bottom: 32px; }
  .section > h2 { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #B8965A; margin-bottom: 16px; letter-spacing: 2px; }
  .day { background: #2c2c2c; padding: 20px; margin-bottom: 12px; border-radius: 4px; border-left: 3px solid #B8965A; }
  .day h3 { color: #B8965A; font-size: 16px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #444; font-size: 14px; }
  th { color: #B8965A; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .rest { color: #888; font-style: italic; }
  .notes { color: #aaa; font-size: 13px; margin-top: 8px; font-style: italic; }
  .macros { display: flex; gap: 20px; margin-bottom: 20px; }
  .macro { background: #2c2c2c; padding: 16px; border-radius: 4px; text-align: center; flex: 1; }
  .macro span { display: block; font-size: 24px; font-weight: 700; color: #B8965A; }
  ul { list-style: none; }
  li { padding: 8px 0; border-bottom: 1px solid #333; font-size: 14px; }
  li strong { color: #B8965A; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; color: #666; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>Week ${weekNo} Program — ${client.name || 'Client'}</h2>
  </div>
  <div class="section">
    <h2>Workout Plan</h2>
    ${workoutHtml}
  </div>
  <div class="section">
    <h2>Nutrition Plan</h2>
    ${nutritionHtml}
  </div>
  <div class="footer">
    <p>FitnessByMaddy © ${new Date().getFullYear()} | This plan is personalized for you. Do not share.</p>
  </div>
</body>
</html>`;
}
