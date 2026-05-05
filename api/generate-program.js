const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'steroid', 'sarms', 'hgh',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
    // Get client data
    const { data: client } = await supabase
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(intake_data, market)')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get last 2 check-ins
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Build prompt
    const prompt = buildProgramPrompt(client, recentCheckins, week_no);

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const generatedText = response.content[0].text;

    // Parse JSON output
    let programData;
    try {
      const jsonMatch = generatedText.match(/```json\n?([\s\S]*?)```/) ||
                        generatedText.match(/\{[\s\S]*"workout_plan"[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : generatedText);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    // Safety check
    const outputStr = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => outputStr.includes(flag));
    if (flagged) {
      const { sendTemplate: notify } = require('./lib/whatsapp');
      await notify('+917082478374', 'escalation_alert', [
        'Safety flag in generated program',
        client.phone,
        `Week ${week_no} - flagged content detected`
      ]);
      return res.status(422).json({ error: 'Program flagged for review', flagged: true });
    }

    // Generate PDF HTML content
    const pdfHtml = renderProgramPDF(client, programData, week_no);

    // Upload PDF HTML to storage
    const filePath = `clients/${client_id}/week_${week_no}.html`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfHtml, {
        contentType: 'text/html',
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError.message);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    // Save to programs table (audit trail)
    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_notes || null
      })
      .select()
      .single();

    // Send via WhatsApp
    const contextNote = programData.coach_notes || `Week ${week_no} program ready!`;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      contextNote.slice(0, 100)
    ]);

    // Mark sent time
    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, weekNo) {
  const intake = client.leads?.intake_data || {};
  const lastCheckin = checkins?.[0];
  const prevCheckin = checkins?.[1];

  return `You are an elite fitness program architect for FitnessByMaddy. Generate a detailed, personalized weekly training and nutrition plan.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: 12-Week Custom (Week ${weekNo} of 12)
- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Height: ${intake.height || 'Unknown'}
- Current Weight: ${lastCheckin?.weight || intake.weight || 'Unknown'}
- Goal: ${intake.goal || 'body recomposition'}
- Experience: ${intake.experience_level || 'intermediate'}
- Training Days Available: ${intake.training_days || '5'}
- Diet Preference: ${intake.diet_preference || 'flexible'}
- Injuries/Limitations: ${intake.injuries || 'None reported'}
- Medical Conditions: ${intake.medical_conditions || 'None'}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight}kg
- Waist: ${lastCheckin.waist}cm
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}
${prevCheckin ? `- Previous weight: ${prevCheckin.weight}kg (change: ${(lastCheckin.weight - prevCheckin.weight).toFixed(1)}kg)` : ''}` : 'No check-in data yet — this is Week 1.'}

RULES:
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Be progressive — increase intensity/volume gradually
- Include deload cues if compliance or energy is below 5
- Provide exercise alternatives for any movements that might aggravate reported injuries
- Tone: warm, expert, encouraging. Not bro-science.

OUTPUT FORMAT (respond ONLY with this JSON, no other text):
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1",
        "focus": "Upper Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "description of weekly cardio recommendation",
    "notes": "any training notes"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fats_g": 70,
    "meal_timing": "description",
    "sample_day": [
      { "meal": "Breakfast", "foods": "description", "macros": "P/C/F" }
    ],
    "supplements": ["creatine 5g", "vitamin D"],
    "notes": "any diet notes"
  },
  "coach_notes": "Brief 1-2 sentence personalized note to the client about this week's focus"
}
\`\`\``;
}

function renderProgramPDF(client, programData, weekNo) {
  const { workout_plan, nutrition_plan, coach_notes } = programData;

  const exerciseRows = (workout_plan.days || []).map(day => `
    <div class="day-block">
      <h3>${day.day} — ${day.focus}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>
        ${(day.exercises || []).map(ex => `
          <tr>
            <td>${ex.name}</td>
            <td>${ex.sets}</td>
            <td>${ex.reps}</td>
            <td>${ex.rest || '-'}</td>
            <td>${ex.notes || '-'}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `).join('');

  const mealRows = (nutrition_plan.sample_day || []).map(meal => `
    <tr><td><strong>${meal.meal}</strong></td><td>${meal.foods}</td><td>${meal.macros || '-'}</td></tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Week ${weekNo} Program - ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; margin-top: 8px; }
  .header p { color: #999; margin-top: 8px; font-size: 14px; }
  .coach-note { background: #222; border-left: 4px solid #B8965A; padding: 20px; margin-bottom: 40px; font-style: italic; color: #ccc; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; margin: 32px 0 16px; letter-spacing: 2px; }
  .day-block { background: #222; padding: 24px; border-radius: 4px; margin-bottom: 16px; }
  .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #B8965A; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; background: #333; color: #B8965A; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  td { padding: 8px 12px; border-bottom: 1px solid #333; font-size: 14px; color: #ddd; }
  .macros-box { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0; }
  .macro-item { background: #222; padding: 20px; text-align: center; border-radius: 4px; }
  .macro-item .value { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-item .label { font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .footer { text-align: center; margin-top: 60px; padding-top: 24px; border-top: 1px solid #333; color: #666; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>Week ${weekNo} Program</h2>
    <p>${client.name || 'Client'} · 12-Week Custom Training</p>
  </div>

  ${coach_notes ? `<div class="coach-note">"${coach_notes}"</div>` : ''}

  <div class="section-title">TRAINING PLAN</div>
  ${exerciseRows}
  ${workout_plan.cardio ? `<div class="day-block"><h3>Cardio</h3><p style="color:#ccc">${workout_plan.cardio}</p></div>` : ''}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="macros-box">
    <div class="macro-item"><div class="value">${nutrition_plan.calories || '-'}</div><div class="label">Calories</div></div>
    <div class="macro-item"><div class="value">${nutrition_plan.protein_g || '-'}g</div><div class="label">Protein</div></div>
    <div class="macro-item"><div class="value">${nutrition_plan.carbs_g || '-'}g</div><div class="label">Carbs</div></div>
    <div class="macro-item"><div class="value">${nutrition_plan.fats_g || '-'}g</div><div class="label">Fats</div></div>
  </div>

  ${nutrition_plan.sample_day ? `
  <div class="day-block">
    <h3>Sample Day</h3>
    <table>
      <tr><th>Meal</th><th>Foods</th><th>Macros</th></tr>
      ${mealRows}
    </table>
  </div>` : ''}

  ${nutrition_plan.supplements ? `
  <div class="day-block">
    <h3>Supplements</h3>
    <p style="color:#ccc">${nutrition_plan.supplements.join(' · ')}</p>
  </div>` : ''}

  <div class="footer">
    <p>Generated by FitnessByMaddy Coaching System · fitnessbymaddy.com</p>
  </div>
</body>
</html>`;
}
