const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'sarm', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for weight loss'
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
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const aiOutput = response.content[0].text;

    if (hasSafetyIssue(aiOutput)) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: 'AI program flagged for safety review',
        phone: client.phone,
        message: `Week ${week_no} program contained risky content. Halted auto-send.`,
        clientName: client.name
      });
      return res.json({ success: false, reason: 'safety_flagged', week_no });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(extractJSON(aiOutput));
      workoutPlan = parsed.workout_plan || parsed.workoutPlan;
      nutritionPlan = parsed.nutrition_plan || parsed.nutritionPlan;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: aiOutput };
      nutritionPlan = {};
      notes = 'Auto-parsed from raw AI output';
    }

    const pdfHtml = renderProgramPDF(client, week_no, workoutPlan, nutritionPlan, notes);

    const pdfPath = `clients/${client_id}/week_${week_no}.html`;
    await db.storage.from('programs').upload(pdfPath, pdfHtml, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    });

    const market = detectMarket(client.phone);
    const isHinglish = market === 'IN';

    const msg = isHinglish
      ? `Week ${week_no} ka program ready hai! 🔥\n\n${notes ? notes + '\n\n' : ''}Plan dekho: ${pdfUrl}\n\nQuestions ho toh poocho. Let's crush it! 💪`
      : `Your Week ${week_no} program is ready! 🔥\n\n${notes ? notes + '\n\n' : ''}View your plan: ${pdfUrl}\n\nGot questions? Just ask. Let's crush it! 💪`;

    await sendWhatsApp({ phone: client.phone, body: msg });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.json({ success: true, client_id, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are "Program Architect" for FitnessByMaddy, an elite online fitness coaching brand.

Generate a Week ${weekNo} training and nutrition program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No check-in data yet (first week).'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

${prevProgram ? `LAST WEEK'S PROGRAM NOTES: ${prevProgram.notes || 'None'}` : ''}

RULES:
- Create a progressive program that builds on previous weeks
- Include 5-6 training days with specific exercises, sets, reps, rest
- Include a nutrition plan with calorie target, macro split, meal timing
- Be science-based. No bro-science. No extreme measures.
- If compliance was low, simplify. If energy was low, reduce volume slightly.
- Minimum 1200 calories for women, 1500 for men. No extreme deficits.
- No banned substances or supplements. Only recommend basic proven supplements.
- Include a short "coach_notes" paragraph with 2-3 sentences of encouragement and focus for the week.

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": "3x 20min LISS or 2x 15min HIIT"
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 60,
    "meal_timing": ["7am Breakfast", "12pm Lunch", "4pm Snack", "7pm Dinner"],
    "notes": "Focus on whole foods, 2L water minimum"
  },
  "coach_notes": "Brief encouragement and week focus"
}`;
}

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function renderProgramPDF(client, weekNo, workout, nutrition, notes) {
  const days = workout?.days || [];
  const daysHtml = days.map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `<div class="day-block">
      <h3>${day.day} — ${day.focus || ''}</h3>
      <table><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr>${exercises}</table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; background:#0a0a0a; color:#fff; padding:40px 24px; }
  .header { text-align:center; margin-bottom:48px; border-bottom:2px solid #B8965A; padding-bottom:32px; }
  .brand { font-family:'Bebas Neue',sans-serif; font-size:32px; letter-spacing:6px; color:#B8965A; }
  .week-title { font-family:'Bebas Neue',sans-serif; font-size:48px; letter-spacing:4px; margin-top:8px; }
  .client-name { color:#888; font-size:14px; margin-top:4px; letter-spacing:2px; text-transform:uppercase; }
  .section-title { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#B8965A; letter-spacing:3px; margin:32px 0 16px; }
  .day-block { background:#151515; border:1px solid #222; border-radius:8px; padding:20px; margin-bottom:16px; }
  .day-block h3 { font-family:'Bebas Neue',sans-serif; font-size:20px; letter-spacing:2px; color:#B8965A; margin-bottom:12px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th { text-align:left; color:#888; font-size:11px; letter-spacing:1px; text-transform:uppercase; padding:8px 4px; border-bottom:1px solid #333; }
  td { padding:8px 4px; border-bottom:1px solid #1a1a1a; }
  .nutrition-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-top:16px; }
  .macro-card { background:#151515; border:1px solid #222; border-radius:8px; padding:20px; text-align:center; }
  .macro-value { font-family:'Bebas Neue',sans-serif; font-size:36px; color:#B8965A; }
  .macro-label { font-size:11px; color:#888; letter-spacing:1px; text-transform:uppercase; margin-top:4px; }
  .notes { background:#151515; border-left:3px solid #B8965A; padding:20px; margin-top:24px; border-radius:0 8px 8px 0; font-style:italic; color:#ccc; line-height:1.7; }
  .footer { text-align:center; margin-top:48px; padding-top:24px; border-top:1px solid #222; color:#555; font-size:12px; }
</style></head><body>
  <div class="header">
    <div class="brand">FITNESS BY MADDY</div>
    <div class="week-title">WEEK ${weekNo} PROGRAM</div>
    <div class="client-name">${client.name || 'Client'}</div>
  </div>
  <div class="section-title">TRAINING PLAN</div>
  ${daysHtml}
  ${workout?.cardio ? `<div class="day-block"><h3>Cardio</h3><p>${workout.cardio}</p></div>` : ''}
  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition-grid">
    <div class="macro-card"><div class="macro-value">${nutrition?.calories || '-'}</div><div class="macro-label">Calories</div></div>
    <div class="macro-card"><div class="macro-value">${nutrition?.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro-card"><div class="macro-value">${nutrition?.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro-card"><div class="macro-value">${nutrition?.fat_g || '-'}g</div><div class="macro-label">Fat</div></div>
  </div>
  ${nutrition?.notes ? `<div class="notes">${nutrition.notes}</div>` : ''}
  ${nutrition?.meal_timing ? `<div style="margin-top:16px;"><strong style="color:#B8965A;">Meal Timing:</strong> ${nutrition.meal_timing.join(' → ')}</div>` : ''}
  ${notes ? `<div class="section-title">COACH'S NOTES</div><div class="notes">${notes}</div>` : ''}
  <div class="footer">© Fitness by Maddy · fitnessbymaddy.com</div>
</body></html>`;
}
