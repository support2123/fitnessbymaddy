const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendMediaMessage } = require('../lib/whatsapp');
const { PROGRAM_NAMES } = require('../lib/helpers');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: leadData } = await supabase
      .from('leads')
      .select('first_msg')
      .eq('id', client.lead_id)
      .single();

    let intakeProfile = {};
    try {
      intakeProfile = JSON.parse(leadData?.first_msg || '{}');
    } catch { /* intake wasn't JSON */ }

    const systemPrompt = `You are Maddy's program architect AI. You design weekly workout and nutrition plans for fitness coaching clients.

RULES:
- Plans must be safe, evidence-based, and appropriate for the client's level
- Never recommend extreme calorie deficits (<1200 cal for women, <1500 cal for men)
- Never recommend banned substances or unproven supplements
- Never promise specific weight loss timelines
- Adjust based on check-in feedback (compliance, energy, issues)
- Use progressive overload principles for workouts
- Include rest days and deload guidance

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "summary": "Brief overview of this week's focus",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "description of cardio recommendation",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 165,
    "carbs_g": 250,
    "fat_g": 70,
    "meal_timing": "description",
    "hydration": "description",
    "supplements": ["creatine 5g", "vitamin D 2000IU"],
    "notes": "any dietary notes"
  },
  "coach_note": "A 1-2 sentence motivational/contextual note for the client"
}`;

    const checkinSummary = recentCheckins?.map(c =>
      `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    ).join('\n') || 'No prior check-ins';

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Age: ${intakeProfile.age || 'unknown'}
- Gender: ${intakeProfile.gender || 'unknown'}
- Goal: ${intakeProfile.goal || 'general fitness'}
- Experience: ${intakeProfile.experience_level || 'intermediate'}
- Injuries/Conditions: ${intakeProfile.injuries || 'none reported'}
- Diet Preference: ${intakeProfile.diet_preference || 'no preference'}
- Equipment: ${intakeProfile.equipment || 'full gym'}
- Schedule: ${intakeProfile.schedule || '5 days/week'}

RECENT CHECK-INS:
${checkinSummary}

Design a progressive, personalized Week ${week_no} plan. If this is Week 1, start with a foundation phase. Adjust based on check-in data.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Program generation returned invalid format' });
    }

    if (isSafeProgram(parsed)) {
      const pdfHtml = generatePdfHtml(client, week_no, parsed);

      const pdfPath = `clients/${client_id}/week_${week_no}.html`;
      const { error: uploadErr } = await supabase.storage
        .from('programs')
        .upload(pdfPath, pdfHtml, {
          contentType: 'text/html',
          upsert: true
        });

      if (uploadErr) console.error('Upload error:', uploadErr.message);

      const { data: publicUrl } = supabase.storage
        .from('programs')
        .getPublicUrl(pdfPath);

      const { error: insertErr } = await supabase.from('programs').insert({
        client_id,
        week_no,
        pdf_url: publicUrl?.publicUrl || pdfPath,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.coach_note
      });

      if (insertErr) throw insertErr;

      if (publicUrl?.publicUrl) {
        const note = parsed.coach_note || `Here's your Week ${week_no} program!`;
        await sendMediaMessage(client.phone, publicUrl.publicUrl, note);

        await supabase.from('programs')
          .update({ whatsapp_sent_at: new Date().toISOString() })
          .eq('client_id', client_id)
          .eq('week_no', week_no);
      }

      return res.status(200).json({ success: true, week_no, program: parsed });

    } else {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        client.phone,
        'unsafe_program_generated',
        `Week ${week_no} program flagged for review — potential safety concern in AI output`
      );
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function isSafeProgram(program) {
  const nutrition = program?.nutrition_plan;
  if (!nutrition) return true;
  if (nutrition.calories && nutrition.calories < 1200) return false;
  const supps = (nutrition.supplements || []).join(' ').toLowerCase();
  const banned = ['steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra', 'hgh', 'testosterone'];
  if (banned.some(b => supps.includes(b))) return false;
  return true;
}

function generatePdfHtml(client, weekNo, program) {
  const workout = program.workout_plan || {};
  const nutrition = program.nutrition_plan || {};

  const daysHtml = (workout.days || []).map(day => `
    <div class="day-block">
      <h3>${day.day} — ${day.focus}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>
        ${(day.exercises || []).map(ex => `
          <tr>
            <td>${ex.name}</td>
            <td>${ex.sets}</td>
            <td>${ex.reps}</td>
            <td>${ex.rest}</td>
            <td>${ex.notes || ''}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #FAF8F4; padding: 40px 24px; }
  .container { max-width: 800px; margin: 0 auto; }
  .header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
  .brand { font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 6px; color: #B8965A; text-transform: uppercase; margin-bottom: 8px; }
  h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #FAF8F4; letter-spacing: 3px; }
  h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; }
  h3 { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: #D4AF7A; letter-spacing: 1px; margin-bottom: 12px; }
  .subtitle { font-size: 14px; color: #999; margin-top: 8px; }
  .day-block { background: #222; border-radius: 8px; padding: 24px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 8px; color: #B8965A; border-bottom: 1px solid #333; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; }
  td { padding: 8px; border-bottom: 1px solid #2a2a2a; color: #ccc; }
  .macro-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 16px 0; }
  .macro-box { background: #222; border-radius: 8px; padding: 20px; text-align: center; }
  .macro-num { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .coach-note { background: linear-gradient(135deg, #2a2a1a, #1a1a1a); border: 1px solid #B8965A; border-radius: 8px; padding: 24px; margin-top: 32px; font-style: italic; color: #D4AF7A; line-height: 1.7; }
  .section-text { font-size: 14px; color: #aaa; line-height: 1.7; }
  @media print { body { background: white; color: #1a1a1a; } .day-block, .macro-box { border: 1px solid #ddd; } }
</style>
</head><body>
<div class="container">
  <div class="header">
    <div class="brand">Fitness by Maddy</div>
    <h1>Week ${weekNo} Program</h1>
    <div class="subtitle">${client.name || 'Client'} — ${PROGRAM_NAMES[client.program] || client.program}</div>
  </div>

  <h2>Workout Plan</h2>
  <p class="section-text">${workout.summary || ''}</p>
  ${daysHtml}
  ${workout.cardio ? `<div class="day-block"><h3>Cardio</h3><p class="section-text">${workout.cardio}</p></div>` : ''}

  <h2>Nutrition Plan</h2>
  <div class="macro-grid">
    <div class="macro-box"><div class="macro-num">${nutrition.calories || '—'}</div><div class="macro-label">Calories</div></div>
    <div class="macro-box"><div class="macro-num">${nutrition.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro-box"><div class="macro-num">${nutrition.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro-box"><div class="macro-num">${nutrition.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
  </div>
  ${nutrition.meal_timing ? `<p class="section-text"><strong>Meal Timing:</strong> ${nutrition.meal_timing}</p>` : ''}
  ${nutrition.hydration ? `<p class="section-text"><strong>Hydration:</strong> ${nutrition.hydration}</p>` : ''}
  ${nutrition.supplements?.length ? `<p class="section-text"><strong>Supplements:</strong> ${nutrition.supplements.join(', ')}</p>` : ''}
  ${nutrition.notes ? `<p class="section-text" style="margin-top:8px">${nutrition.notes}</p>` : ''}

  ${program.coach_note ? `<div class="coach-note">"${program.coach_note}"<br><span style="font-style:normal; font-size:12px; color:#999;">— Maddy</span></div>` : ''}
</div>
</body></html>`;
}
