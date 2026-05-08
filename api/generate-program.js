const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { PROGRAM_NAMES } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'sarms', 'steroids', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram, week_no);

    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;

    const safetyIssue = SAFETY_FLAGS.find(flag =>
      responseText.toLowerCase().includes(flag)
    );
    if (safetyIssue) {
      await escalateToMaddy(
        'Unsafe program content flagged',
        client.phone,
        `Week ${week_no}: flagged "${safetyIssue}"`
      );
      return res.status(200).json({ action: 'flagged_for_review', flag: safetyIssue });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workoutPlan = parsed.workout_plan || parsed.workouts;
        nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
        notes = parsed.notes || parsed.coach_notes;
      } else {
        workoutPlan = { raw: responseText };
        nutritionPlan = {};
        notes = '';
      }
    } catch (_) {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
      notes = '';
    }

    const pdfContent = generatePdfHtml(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfBlob = new Blob([pdfContent], { type: 'text/html' });
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(pdfPath, pdfBlob, { upsert: true });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error } = await db.from('programs').upsert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
    }, { onConflict: 'client_id,week_no' });

    if (error) {
      console.error('Program insert error:', error.message);
    }

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      pdfUrl,
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Week: ${weekNo}

RECENT CHECK-IN DATA:
${checkinSummary || 'No check-in data yet (first week)'}

${prevProgram ? `PREVIOUS WEEK PLAN NOTES: ${prevProgram.notes || 'None'}` : ''}

INSTRUCTIONS:
1. Create a complete 7-day workout plan appropriate for the client's program and progress
2. Create a nutrition plan with daily macro targets and meal suggestions
3. Add coaching notes about focus areas for this week
4. Adjust intensity based on compliance and energy scores
5. If compliance is below 6, simplify the plan
6. If energy is below 5, reduce volume and add recovery days
7. NEVER recommend extreme calorie deficits (below 1200 cal for women, 1500 for men)
8. NEVER recommend any banned substances or supplements with safety concerns

OUTPUT FORMAT — respond with a single JSON block:
\`\`\`json
{
  "workout_plan": {
    "monday": { "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "10-12", "rest": "60s"}] },
    "tuesday": { "focus": "...", "exercises": [...] },
    "wednesday": { "focus": "...", "exercises": [...] },
    "thursday": { "focus": "...", "exercises": [...] },
    "friday": { "focus": "...", "exercises": [...] },
    "saturday": { "focus": "...", "exercises": [...] },
    "sunday": { "focus": "Rest / Active Recovery", "exercises": [] }
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "suggestion": "..." },
      { "meal": "Lunch", "suggestion": "..." },
      { "meal": "Snack", "suggestion": "..." },
      { "meal": "Dinner", "suggestion": "..." }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["whey protein", "creatine monohydrate", "vitamin D"]
  },
  "notes": "Coach notes for this week..."
}
\`\`\``;
}

function generatePdfHtml(client, weekNo, workout, nutrition, notes) {
  const days = workout && typeof workout === 'object' && !workout.raw
    ? Object.entries(workout)
    : [];

  const dayBlocks = days.map(([day, data]) => {
    if (!data || !data.exercises) return '';
    const exercises = (data.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets} x ${ex.reps}</td><td>${ex.rest || '-'}</td></tr>`
    ).join('');
    return `
      <div class="day-block">
        <h3>${day.charAt(0).toUpperCase() + day.slice(1)} — ${data.focus || ''}</h3>
        <table><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th></tr>${exercises}</table>
      </div>`;
  }).join('');

  const nutritionBlock = nutrition && nutrition.daily_calories ? `
    <div class="nutrition-block">
      <h2>Nutrition Plan</h2>
      <div class="macros">
        <div class="macro"><span>${nutrition.daily_calories}</span>Calories</div>
        <div class="macro"><span>${nutrition.protein_g}g</span>Protein</div>
        <div class="macro"><span>${nutrition.carbs_g}g</span>Carbs</div>
        <div class="macro"><span>${nutrition.fat_g}g</span>Fat</div>
      </div>
      ${(nutrition.meals || []).map(m => `<p><strong>${m.meal}:</strong> ${m.suggestion}</p>`).join('')}
      <p><strong>Hydration:</strong> ${nutrition.hydration || '3-4L water'}</p>
    </div>` : '';

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; background:#111; color:#fff; padding:40px 24px; }
  .header { text-align:center; margin-bottom:48px; border-bottom:2px solid #B8965A; padding-bottom:32px; }
  .header h1 { font-family:'Bebas Neue',sans-serif; font-size:48px; color:#B8965A; letter-spacing:4px; }
  .header p { color:#888; font-size:14px; margin-top:8px; }
  .day-block { background:#1a1a1a; border-radius:8px; padding:24px; margin-bottom:16px; border-left:3px solid #B8965A; }
  .day-block h3 { font-family:'Bebas Neue',sans-serif; font-size:22px; color:#B8965A; margin-bottom:12px; letter-spacing:2px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; padding:8px 0; border-bottom:1px solid #333; }
  td { padding:10px 0; font-size:14px; border-bottom:1px solid #222; }
  .nutrition-block { background:#1a1a1a; border-radius:8px; padding:24px; margin-top:32px; border-left:3px solid #B8965A; }
  .nutrition-block h2 { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#B8965A; margin-bottom:16px; }
  .macros { display:flex; gap:16px; margin-bottom:20px; flex-wrap:wrap; }
  .macro { background:#222; border-radius:8px; padding:16px; text-align:center; flex:1; min-width:80px; }
  .macro span { display:block; font-size:24px; font-weight:600; color:#B8965A; }
  .notes { margin-top:32px; background:#0a0a0a; border:1px solid #333; border-radius:8px; padding:24px; }
  .notes h2 { font-family:'Bebas Neue',sans-serif; color:#B8965A; font-size:22px; margin-bottom:8px; }
  .footer { text-align:center; margin-top:48px; padding-top:24px; border-top:1px solid #333; color:#555; font-size:12px; }
</style>
</head><body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <p>Week ${weekNo} Program — ${client.name || 'Client'}</p>
  </div>
  ${dayBlocks}
  ${nutritionBlock}
  ${notes ? `<div class="notes"><h2>Coach Notes</h2><p>${notes}</p></div>` : ''}
  <div class="footer">Fitness by Maddy &middot; fitnessbymaddy.com</div>
</body></html>`;
}
