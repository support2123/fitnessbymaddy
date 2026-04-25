const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const RISKY_PATTERNS = [
  /under\s*\d{3}\s*cal/i,
  /less than\s*800\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /sarm/i,
  /steroid/i,
  /lose\s*\d{2,}\s*kg\s*in\s*\d\s*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
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
      .select('*, leads!clients_lead_id_fkey(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('phone', client.phone)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, intake, recentCheckins, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      await escalateToMaddy('Program generation returned non-JSON', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} generation failed to parse`,
      });
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programData = JSON.parse(jsonMatch[1]);

    const fullText = JSON.stringify(programData);
    const isRisky = RISKY_PATTERNS.some(p => p.test(fullText));
    if (isRisky) {
      await escalateToMaddy('Risky content detected in generated program', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} flagged for review`,
      });
      return res.status(200).json({ flagged: true, reason: 'risky_content' });
    }

    const pdfHtml = renderProgramHTML(client, programData, week_no);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `${client.id}/week_${week_no}.html`;

    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData.publicUrl,
      workout_plan: programData.workout_plan || programData.workout,
      nutrition_plan: programData.nutrition_plan || programData.nutrition,
      notes: programData.notes || null,
    });

    if (insertError) throw insertError;

    const contextNote = programData.notes || `Your Week ${week_no} program is ready!`;
    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      contextNote.slice(0, 100),
    ], urlData.publicUrl);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  let prompt = `You are "Program Architect" for FitnessByMaddy, an elite online fitness coaching brand.

Generate a Week ${weekNo} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
`;

  if (intake) {
    prompt += `
INTAKE DATA:
- Age: ${intake.age || 'N/A'}, Gender: ${intake.gender || 'N/A'}
- Goal: ${intake.goal || 'General fitness'}
- Current Weight: ${intake.current_weight || 'N/A'} kg, Target: ${intake.target_weight || 'N/A'} kg
- Height: ${intake.height || 'N/A'} cm
- Injuries: ${intake.injuries || 'None reported'}
- Medical: ${intake.medical_conditions || 'None'}
- Diet Preference: ${intake.diet_preference || 'No preference'}
- Workout Days: ${intake.workout_days || 5}/week
- Location: ${intake.workout_location || 'Gym'}
`;
  }

  if (checkins && checkins.length > 0) {
    prompt += '\nRECENT CHECK-INS:\n';
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}\n`;
    }
  }

  prompt += `
RULES:
- Never recommend under 1200 calories for women or 1500 for men
- Never recommend any banned substances or supplements with known side effects
- Never promise specific weight loss timelines
- Be progressive: increase volume/intensity gradually
- Include warm-up and cool-down
- Provide alternatives for each exercise

OUTPUT FORMAT (respond with ONLY this JSON block):
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "alternative": "Dumbbell Press" }
        ],
        "warmup": "5 min incline walk + dynamic stretches",
        "cooldown": "5 min static stretching"
      }
    ],
    "rest_days": ["Day 4", "Day 7"],
    "cardio": "3x/week, 20 min moderate intensity"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 75,
    "meals": [
      { "meal": "Meal 1 - Breakfast", "options": ["4 egg whites + 1 whole egg + oats", "Greek yogurt + granola + berries"] }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine monohydrate 5g", "Multivitamin"]
  },
  "notes": "Brief 1-liner context for this week's focus"
}
\`\`\``;

  return prompt;
}

function renderProgramHTML(client, program, weekNo) {
  const workout = program.workout_plan || program.workout || {};
  const nutrition = program.nutrition_plan || program.nutrition || {};
  const days = workout.days || [];
  const meals = nutrition.meals || [];

  let daysHtml = '';
  for (const day of days) {
    let exercisesHtml = '';
    for (const ex of (day.exercises || [])) {
      exercisesHtml += `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest}</td><td>${ex.alternative || '-'}</td></tr>`;
    }
    daysHtml += `
      <div class="day-block">
        <h3>${day.day}</h3>
        <p class="warmup">Warm-up: ${day.warmup || 'General warm-up'}</p>
        <table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Alternative</th></tr></thead><tbody>${exercisesHtml}</tbody></table>
        <p class="cooldown">Cool-down: ${day.cooldown || 'Stretching'}</p>
      </div>`;
  }

  let mealsHtml = '';
  for (const meal of meals) {
    const options = (meal.options || []).map(o => `<li>${o}</li>`).join('');
    mealsHtml += `<div class="meal"><h4>${meal.meal}</h4><ul>${options}</ul></div>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program - ${client.name || 'Client'}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#e0e0e0;padding:24px;max-width:800px;margin:0 auto}
h1,h2,h3{font-family:'Bebas Neue',sans-serif;letter-spacing:2px}
h1{font-size:42px;color:#B8965A;border-bottom:2px solid #B8965A;padding-bottom:12px;margin-bottom:8px}
h2{font-size:28px;color:#D4AF7A;margin:32px 0 16px;border-left:4px solid #B8965A;padding-left:12px}
h3{font-size:20px;color:#fff;margin-bottom:12px}
h4{font-size:16px;color:#B8965A;margin-bottom:8px}
.subtitle{color:#888;font-size:14px;margin-bottom:32px}
.day-block{background:#222;border-radius:8px;padding:20px;margin-bottom:16px}
.warmup,.cooldown{font-size:13px;color:#888;margin:8px 0}
table{width:100%;border-collapse:collapse;margin:12px 0}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#B8965A;padding:8px;border-bottom:1px solid #333}
td{padding:8px;border-bottom:1px solid #2a2a2a;font-size:14px}
.macros{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
.macro-box{background:#222;padding:16px;border-radius:8px;text-align:center}
.macro-box .val{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A}
.macro-box .lbl{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px}
.meal{background:#222;padding:16px;border-radius:8px;margin-bottom:12px}
.meal ul{list-style:none;padding:0}
.meal li{padding:4px 0;font-size:14px;color:#ccc}
.meal li::before{content:'→ ';color:#B8965A}
.notes{background:#2a2a1a;border:1px solid #B8965A;padding:16px;border-radius:8px;margin-top:24px;font-size:14px;color:#D4AF7A}
.footer{text-align:center;margin-top:40px;padding-top:20px;border-top:1px solid #333;color:#555;font-size:12px}
@media(max-width:600px){.macros{grid-template-columns:repeat(2,1fr)}}
</style></head><body>
<h1>WEEK ${weekNo} PROGRAM</h1>
<p class="subtitle">${client.name || 'Client'} &bull; ${client.program?.toUpperCase().replace('_', ' ')} &bull; FitnessByMaddy</p>

<h2>WORKOUT PLAN</h2>
${daysHtml}
${workout.rest_days ? `<p style="color:#888;font-size:13px;margin:8px 0">Rest days: ${workout.rest_days.join(', ')}</p>` : ''}
${workout.cardio ? `<p style="color:#888;font-size:13px">Cardio: ${workout.cardio}</p>` : ''}

<h2>NUTRITION PLAN</h2>
<div class="macros">
  <div class="macro-box"><div class="val">${nutrition.calories || '-'}</div><div class="lbl">Calories</div></div>
  <div class="macro-box"><div class="val">${nutrition.protein_g || '-'}g</div><div class="lbl">Protein</div></div>
  <div class="macro-box"><div class="val">${nutrition.carbs_g || '-'}g</div><div class="lbl">Carbs</div></div>
  <div class="macro-box"><div class="val">${nutrition.fat_g || '-'}g</div><div class="lbl">Fat</div></div>
</div>
${mealsHtml}
${nutrition.hydration ? `<p style="color:#888;font-size:13px;margin:12px 0">Hydration: ${nutrition.hydration}</p>` : ''}
${nutrition.supplements ? `<p style="color:#888;font-size:13px">Supplements: ${nutrition.supplements.join(', ')}</p>` : ''}

${program.notes ? `<div class="notes"><strong>Coach's Note:</strong> ${program.notes}</div>` : ''}

<div class="footer">FitnessByMaddy &bull; fitnessbymaddy.com &bull; @fitnessbymaddy_</div>
</body></html>`;
}
