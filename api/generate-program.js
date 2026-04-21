const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalate');
const { cors, parseBody } = require('./lib/helpers');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 1000 calories',
  'clenbuterol', 'dnp', 'ephedrine', 'semaglutide', 'ozempic',
  'steroids', 'anabolic',
  'lose 10 kg in a week', 'lose 20 pounds in a week',
  'extreme deficit', 'starvation',
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      total_weeks: client.program === '12wk' ? 12 : 6,
      intake: intakeForm ? {
        age: intakeForm.age,
        goal: intakeForm.goal,
        injuries: intakeForm.injuries,
        diet_pref: intakeForm.diet_pref,
        schedule: intakeForm.schedule,
        medical: intakeForm.medical_conditions,
      } : null,
      recent_checkins: (checkins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues,
      })),
      previous_plan: prevPrograms?.[0] || null,
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n\n${JSON.stringify(clientProfile, null, 2)}`,
      }],
    });

    const content = response.content[0]?.text || '';

    const lower = content.toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => lower.includes(f));
    if (flagged) {
      await escalateToMaddy('Program flagged for safety review', {
        phone: client.phone,
        name: client.name,
        program: client.program,
        extra: `Week ${week_no} — auto-generation halted due to safety flag`,
      });
      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/(\{[\s\S]*\})/);
      parsed = JSON.parse(jsonMatch[1]);
    } catch {
      parsed = { raw: content };
    }

    const workoutPlan = parsed.workout_plan || parsed.workout || parsed;
    const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    const weeklyNotes = parsed.notes || parsed.coach_notes || '';

    const pdfHtml = generatePdfHtml(client, week_no, workoutPlan, nutritionPlan, weeklyNotes);

    const pdfPath = `clients/${client_id}/week_${week_no}.html`;
    await supabase.storage.from('client-files').upload(pdfPath, pdfHtml, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || '';

    const { error: progError } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: weeklyNotes,
    });

    if (progError) {
      console.error('Program insert error:', progError.message);
    }

    const contextNote = week_no === 1
      ? `Here's your Week 1 program, ${client.name}! Let's set the foundation right 💪`
      : `Week ${week_no} is here! ${weeklyNotes || 'Keep pushing forward 💪'}`;

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      contextNote,
      pdfUrl,
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({
      success: true,
      client_id,
      week_no,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

const SYSTEM_PROMPT = `You are a certified fitness program architect for Fitness by Maddy, an elite online coaching brand. You create personalized weekly workout and nutrition plans.

RULES:
- Programs must be safe, evidence-based, and progressive
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, steroids, or pharmaceutical weight loss drugs
- Account for injuries, medical conditions, and dietary preferences
- Progressive overload: increase volume/intensity gradually week-over-week
- If compliance is dropping, simplify the plan rather than adding more
- If energy is low, check nutrition adequacy before increasing training

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..."}
        ],
        "cardio": "...",
        "duration_mins": 45
      }
    ],
    "rest_days": ["Sunday"],
    "weekly_volume_sets": 0
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "sample_meals": [
      {"meal": "Breakfast", "options": ["..."]}
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coach note about this week's focus and adjustments"
}`;

function generatePdfHtml(client, weekNo, workout, nutrition, notes) {
  const days = workout?.days || [];
  const workoutHtml = days.map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name}</td>
        <td>${ex.sets} × ${ex.reps}</td>
        <td>${ex.rest || '-'}</td>
        <td>${ex.notes || ''}</td>
      </tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.day} — ${day.focus || ''}</h3>
        ${day.cardio ? `<p class="cardio">Cardio: ${day.cardio}</p>` : ''}
        <table>
          <thead><tr><th>Exercise</th><th>Sets × Reps</th><th>Rest</th><th>Notes</th></tr></thead>
          <tbody>${exercises}</tbody>
        </table>
      </div>`;
  }).join('');

  const meals = (nutrition?.sample_meals || []).map(m =>
    `<div class="meal"><strong>${m.meal}:</strong> ${(m.options || []).join(' / ')}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=DM+Sans:wght@300;400;500&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #FAF8F4; color: #2C2C2C; padding: 40px 24px; max-width: 800px; margin: 0 auto; }
  .header { text-align: center; padding: 32px 0; border-bottom: 2px solid #B8965A; margin-bottom: 32px; }
  .header h1 { font-family: 'Cormorant Garamond', serif; font-size: 32px; color: #2C2C2C; margin-bottom: 8px; }
  .header h2 { font-family: 'Cormorant Garamond', serif; font-size: 22px; color: #B8965A; font-weight: 400; }
  .header p { color: #6B6B6B; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Cormorant Garamond', serif; font-size: 24px; color: #B8965A; margin: 28px 0 16px; padding-bottom: 8px; border-bottom: 1px solid #E8E3DC; }
  .day-block { margin-bottom: 24px; background: #fff; padding: 20px; border-radius: 4px; border: 1px solid #E8E3DC; }
  .day-block h3 { font-family: 'Cormorant Garamond', serif; font-size: 18px; color: #2C2C2C; margin-bottom: 12px; }
  .cardio { font-size: 13px; color: #6B6B6B; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 8px; background: #2C2C2C; color: #fff; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  td { padding: 8px; border-bottom: 1px solid #E8E3DC; }
  .macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .macro-card { background: #2C2C2C; color: #fff; padding: 16px; border-radius: 4px; text-align: center; }
  .macro-card .num { font-size: 28px; font-weight: 600; color: #B8965A; }
  .macro-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .meal { padding: 8px 0; border-bottom: 1px solid #E8E3DC; font-size: 14px; }
  .coach-note { background: #B8965A; color: #fff; padding: 20px; border-radius: 4px; margin-top: 28px; font-size: 14px; line-height: 1.6; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #E8E3DC; font-size: 12px; color: #6B6B6B; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>Week ${weekNo} Program</h2>
    <p>${client.name} • ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
  </div>

  <h2 class="section-title">Workout Plan</h2>
  ${workoutHtml || '<p>No workout data generated</p>'}

  <h2 class="section-title">Nutrition Plan</h2>
  <div class="macros">
    <div class="macro-card"><div class="num">${nutrition?.calories || '—'}</div><div class="label">Calories</div></div>
    <div class="macro-card"><div class="num">${nutrition?.protein_g || '—'}g</div><div class="label">Protein</div></div>
    <div class="macro-card"><div class="num">${nutrition?.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
    <div class="macro-card"><div class="num">${nutrition?.fats_g || '—'}g</div><div class="label">Fats</div></div>
  </div>
  ${meals || ''}
  ${nutrition?.hydration ? `<p style="margin-top:12px;font-size:14px;">💧 ${nutrition.hydration}</p>` : ''}

  ${notes ? `<div class="coach-note"><strong>Coach's Note:</strong> ${notes}</div>` : ''}

  <div class="footer">
    <p>Fitness by Maddy • fitnessbymaddy.com • @fitnessbymaddy_</p>
  </div>
</body>
</html>`;
}
