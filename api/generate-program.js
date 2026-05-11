const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const RISKY_TERMS = [
  'less than 1000 calories', 'under 800 cal', '500 cal', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm', 'anavar',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme fasting', 'no food', 'zero calorie'
];

function containsRiskyContent(text) {
  const lower = text.toLowerCase();
  return RISKY_TERMS.some(term => lower.includes(term));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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

    const { data: intakeFile } = await supabase.storage
      .from('client-files')
      .download(`intakes/${client.lead_id}/intake.json`);

    let intakeData = null;
    if (intakeFile) {
      try {
        const text = await intakeFile.text();
        intakeData = JSON.parse(text);
      } catch (e) {}
    }

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const prompt = buildPrompt(client, intakeData, checkinSummary, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const output = response.content[0].text;

    if (containsRiskyContent(output)) {
      const { createEscalation } = require('./lib/escalation');
      await createEscalation(
        client.phone,
        'risky_program_content',
        `Week ${week_no} program flagged for review. Client: ${client.name}`
      );
      return res.status(200).json({
        success: false,
        reason: 'Content flagged for Maddy review',
        flagged: true
      });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(output);
      workoutPlan = parsed.workout_plan || parsed.workout;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch (e) {
      workoutPlan = { raw: output };
      nutritionPlan = {};
      notes = 'Output was not structured JSON — review raw content.';
    }

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }).select().single();

    const pdfHtml = buildProgramPdf(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;
    await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfHtml, {
        contentType: 'text/html',
        upsert: true
      });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    await supabase.from('programs')
      .update({ pdf_url: urlData.publicUrl })
      .eq('id', program.id);

    const msg = `Your Week ${week_no} program is ready! 💪\n\nView it here: ${urlData.publicUrl}\n\n${notes ? `Coach note: ${notes}` : 'Let\'s make this week count!'}`;

    await sendWhatsApp({ phone: client.phone, body: msg });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, programId: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  return `You are a NASM-certified fitness program architect for FitnessByMaddy, an elite online coaching service.

Generate a complete Week ${weekNo} program for this client. Return ONLY valid JSON.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intake ? `- Age: ${intake.age}
- Gender: ${intake.gender}
- Goal: ${intake.goal}
- Injuries: ${intake.injuries || 'None'}
- Diet preference: ${intake.diet_preference || 'No restrictions'}
- Experience: ${intake.experience_level || 'Intermediate'}
- Current weight: ${intake.current_weight || 'Not provided'}
- Target weight: ${intake.target_weight || 'Not provided'}
- Schedule: ${intake.schedule || '5 days/week'}` : '- No intake data available — provide a balanced intermediate program'}

RECENT CHECK-INS:
${checkins.length > 0 ? JSON.stringify(checkins, null, 2) : 'No check-ins yet (Week 1)'}

RULES:
- Be evidence-based and safe. Never suggest extreme calorie cuts below 1200 cal/day.
- Never recommend any banned substances or supplements without research backing.
- Adjust based on compliance score and energy levels from check-ins.
- If issues are reported, modify exercises to accommodate.
- Include warm-up and cool-down in every session.

Return JSON in this exact format:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "exercise", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + arm circles",
        "cooldown": "5 min stretching"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["option 1", "option 2"] }
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "Brief coach note about this week's focus and adjustments"
}`;
}

function buildProgramPdf(client, weekNo, workout, nutrition, notes) {
  const days = workout?.days || [];
  const meals = nutrition?.meals || [];

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 0; }
.header { background: linear-gradient(135deg, #1a1a1a, #2c2c2c); padding: 40px 32px; text-align: center; border-bottom: 3px solid #B8965A; }
.brand { font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 6px; color: #B8965A; text-transform: uppercase; margin-bottom: 8px; }
h1 { font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: 3px; color: #fff; }
.subtitle { font-size: 13px; color: #888; margin-top: 8px; }
.section { padding: 32px; }
.section-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; letter-spacing: 2px; color: #B8965A; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 8px; }
.day-card { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
.day-name { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #B8965A; }
.day-focus { font-size: 12px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; }
.exercise { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #333; font-size: 14px; }
.exercise:last-child { border-bottom: none; }
.exercise-name { color: #fff; }
.exercise-detail { color: #B8965A; font-size: 13px; }
.warmup, .cooldown { font-size: 12px; color: #666; padding: 4px 0; font-style: italic; }
.macro-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
.macro-card { background: #222; border-radius: 8px; padding: 16px; text-align: center; }
.macro-val { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; }
.macro-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
.meal-item { background: #222; border-radius: 8px; padding: 16px; margin-bottom: 8px; }
.meal-name { font-size: 13px; font-weight: 600; color: #B8965A; margin-bottom: 4px; }
.meal-options { font-size: 13px; color: #ccc; }
.notes { background: #B8965A; color: #1a1a1a; padding: 24px 32px; font-size: 14px; line-height: 1.6; }
.notes strong { display: block; font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2px; margin-bottom: 8px; }
.footer { text-align: center; padding: 24px; font-size: 11px; color: #555; border-top: 1px solid #333; }
@media (max-width: 500px) { .macro-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>
<div class="header">
  <div class="brand">Fitness by Maddy</div>
  <h1>Week ${weekNo} Program</h1>
  <div class="subtitle">${client.name} · ${client.program.replace(/_/g, ' ').toUpperCase()}</div>
</div>

<div class="section">
  <div class="section-title">Workout Plan</div>
  ${days.map(day => `
  <div class="day-card">
    <div class="day-name">${day.day || 'Training Day'}</div>
    <div class="day-focus">${day.focus || ''}</div>
    ${day.warmup ? `<div class="warmup">Warm-up: ${day.warmup}</div>` : ''}
    ${(day.exercises || []).map(ex => `
    <div class="exercise">
      <span class="exercise-name">${ex.name}</span>
      <span class="exercise-detail">${ex.sets || 3}×${ex.reps || '10'} | Rest ${ex.rest || '60s'}</span>
    </div>`).join('')}
    ${day.cooldown ? `<div class="cooldown">Cool-down: ${day.cooldown}</div>` : ''}
  </div>`).join('')}
</div>

<div class="section">
  <div class="section-title">Nutrition Plan</div>
  <div class="macro-grid">
    <div class="macro-card"><div class="macro-val">${nutrition?.calories || '—'}</div><div class="macro-label">Calories</div></div>
    <div class="macro-card"><div class="macro-val">${nutrition?.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro-card"><div class="macro-val">${nutrition?.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro-card"><div class="macro-val">${nutrition?.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
  </div>
  ${meals.map(m => `
  <div class="meal-item">
    <div class="meal-name">${m.meal}</div>
    <div class="meal-options">${Array.isArray(m.options) ? m.options.join(' · ') : m.options || ''}</div>
  </div>`).join('')}
  ${nutrition?.hydration ? `<div class="meal-item"><div class="meal-name">Hydration</div><div class="meal-options">${nutrition.hydration}</div></div>` : ''}
  ${nutrition?.supplements ? `<div class="meal-item"><div class="meal-name">Supplements</div><div class="meal-options">${Array.isArray(nutrition.supplements) ? nutrition.supplements.join(', ') : nutrition.supplements}</div></div>` : ''}
</div>

${notes ? `<div class="notes"><strong>Coach's Note</strong>${notes}</div>` : ''}

<div class="footer">© ${new Date().getFullYear()} Fitness by Maddy · fitnessbymaddy.com</div>
</body>
</html>`;
}
