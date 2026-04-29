const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'below 800 cal',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet', 'starvation'
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

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

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

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildProgramPrompt(client, recentCheckins || [], previousProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const programText = response.content[0].text;

    const safetyIssue = checkSafety(programText);
    if (safetyIssue) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nFlag: ${safetyIssue}\n\nProgram held — needs manual review.`
      );
      return res.status(200).json({ success: false, flagged: true, reason: safetyIssue });
    }

    let parsed;
    try {
      const jsonMatch = programText.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : programText);
    } catch (e) {
      parsed = { raw: programText };
    }

    const workoutPlan = parsed.workout_plan || parsed.workouts || parsed;
    const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    const notes = parsed.notes || parsed.coach_notes || '';

    const pdfHtml = buildPdfHtml(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `${client_id}/week_${week_no}.html`;

    await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, { contentType: 'text/html', upsert: true });

    const { data: pdfUrl } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl.publicUrl,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes
      })
      .select()
      .single();

    if (error) {
      console.error(`Program save error for ${maskPhone(client.phone)}:`, error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(week_no),
        pdfUrl.publicUrl
      ]
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    await notifyMaddy('Program generation failed', `Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildProgramPrompt(client, checkins, prevProgram, weekNo) {
  const latestCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are an expert fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No specific preference'}
- Schedule: ${client.schedule || 'Flexible'}
- Program: ${client.program} (Week ${weekNo} of ${client.program === '12wk' ? 12 : 6})

${latestCheckin ? `LATEST CHECK-IN (Week ${latestCheckin.week_no}):
- Weight: ${latestCheckin.weight || 'Not reported'} kg
- Waist: ${latestCheckin.waist || 'Not reported'} cm
- Compliance: ${latestCheckin.compliance_score || 'N/A'}/10
- Energy: ${latestCheckin.energy || 'N/A'}/10
- Issues: ${latestCheckin.issues || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'Not reported'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10` : ''}

${prevProgram ? `PREVIOUS PROGRAM NOTES: ${prevProgram.notes || 'None'}` : ''}

Generate a complete weekly program in JSON format with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min light cardio + dynamic stretches",
        "cooldown": "5 min stretching"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "suggestion": "Oats with protein powder and banana", "calories": 450 }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "Coach's note about this week's focus and adjustments"
}

RULES:
- Be realistic and safe. No extreme calorie deficits (minimum 1200 cal for women, 1500 for men).
- Respect injuries and limitations.
- Progress gradually from previous week if data available.
- Include rest days.
- Keep nutrition culturally appropriate (Indian diet options if client is from India).
- Output ONLY valid JSON, wrapped in \`\`\`json code blocks.`;
}

function checkSafety(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }

  const calMatch = lower.match(/(\d+)\s*(?:cal|kcal|calories)/);
  if (calMatch && parseInt(calMatch[1]) < 1000 && parseInt(calMatch[1]) > 0) {
    return `dangerously low calories: ${calMatch[1]}`;
  }

  return null;
}

function buildPdfHtml(client, weekNo, workout, nutrition, notes) {
  const workoutDays = workout.days || workout || [];
  const meals = nutrition.meals || [];

  const exerciseRows = (Array.isArray(workoutDays) ? workoutDays : []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.day} — ${day.focus || ''}</h3>
        ${day.warmup ? `<p class="meta">Warmup: ${day.warmup}</p>` : ''}
        <table>
          <thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
        ${day.cooldown ? `<p class="meta">Cooldown: ${day.cooldown}</p>` : ''}
      </div>`;
  }).join('');

  const mealRows = meals.map(m =>
    `<tr><td>${m.meal}</td><td>${m.suggestion}</td><td>${m.calories || '-'}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'DM Sans', sans-serif; background: #0a0a0a; color: #fff; padding: 40px 24px; }
    .header { text-align: center; border-bottom: 2px solid #B8965A; padding-bottom: 24px; margin-bottom: 32px; }
    .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 42px; color: #B8965A; letter-spacing: 4px; }
    .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
    .header p { color: #888; font-size: 14px; margin-top: 8px; }
    .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; letter-spacing: 3px; margin: 32px 0 16px; }
    .day-block { background: #1a1a1a; border-radius: 8px; padding: 20px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
    .day-block h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #fff; letter-spacing: 2px; margin-bottom: 12px; }
    .meta { color: #888; font-size: 13px; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th { text-align: left; color: #B8965A; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; padding: 8px; border-bottom: 1px solid #333; }
    td { padding: 8px; font-size: 14px; color: #ccc; border-bottom: 1px solid #1f1f1f; }
    .macros { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
    .macro-box { background: #1a1a1a; border-radius: 8px; padding: 16px 24px; text-align: center; flex: 1; min-width: 100px; }
    .macro-box .num { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
    .macro-box .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .notes { background: #1a1a1a; border-radius: 8px; padding: 20px; margin-top: 24px; border-left: 3px solid #B8965A; }
    .notes p { color: #ccc; font-size: 14px; line-height: 1.7; }
    .footer { text-align: center; margin-top: 40px; padding-top: 24px; border-top: 1px solid #333; }
    .footer p { color: #555; font-size: 12px; }
    @media print { body { background: #fff; color: #000; } .day-block, .macro-box, .notes { background: #f5f5f5; } td, .notes p, .meta { color: #333; } th { color: #8B6914; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Fitness by Maddy</h1>
    <h2>Week ${weekNo} Program</h2>
    <p>${client.name || 'Client'} &middot; ${client.program?.replace(/_/g, ' ').toUpperCase() || 'CUSTOM'}</p>
  </div>

  <div class="section-title">Workout Plan</div>
  ${exerciseRows || '<p style="color:#888">Workout plan will be updated after check-in review.</p>'}

  <div class="section-title">Nutrition Plan</div>
  <div class="macros">
    <div class="macro-box"><div class="num">${nutrition.calories || '-'}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="num">${nutrition.protein_g || '-'}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="num">${nutrition.carbs_g || '-'}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="num">${nutrition.fat_g || '-'}g</div><div class="label">Fat</div></div>
  </div>
  ${mealRows ? `<table><thead><tr><th>Meal</th><th>Suggestion</th><th>Cal</th></tr></thead><tbody>${mealRows}</tbody></table>` : ''}
  ${nutrition.hydration ? `<p class="meta">Hydration: ${nutrition.hydration}</p>` : ''}
  ${nutrition.supplements ? `<p class="meta">Supplements: ${nutrition.supplements.join(', ')}</p>` : ''}

  ${notes ? `<div class="section-title">Coach's Notes</div><div class="notes"><p>${notes}</p></div>` : ''}

  <div class="footer">
    <p>Fitness by Maddy &middot; fitnessbymaddy.com &middot; Generated ${new Date().toLocaleDateString('en-IN')}</p>
  </div>
</body>
</html>`;
}
