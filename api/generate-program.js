import Anthropic from '@anthropic-ai/sdk';
import supabase from '../lib/supabase.js';
import { sendText, notifyMaddy } from '../lib/whatsapp.js';

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /anabolic/i,
  /steroid/i,
  /ephedra/i,
  /sarm/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*(in|per)\s*(a\s*)?week/i,
];

function hasSafetyIssues(text) {
  return RISKY_PATTERNS.some(p => p.test(text));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: intake } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect working for Fitness by Maddy.
Generate a weekly training and nutrition program in JSON format.

Rules:
- Programs must be safe, evidence-based, and realistic
- Never prescribe fewer than 1400 calories for women or 1600 for men
- Never recommend banned substances, SARMs, or anabolic steroids
- Never promise unrealistic timelines (e.g., "lose 10kg in a week")
- Adapt based on check-in data: compliance, energy, weight trends
- Include warm-up and cool-down in every workout
- Account for injuries and medical conditions from intake

Output JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "cardio": "...",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "...", "macros": "..." }
    ],
    "hydration": "...",
    "supplements": "..."
  },
  "notes": "Week focus and adjustments explanation"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
Name: ${client.name}
Program: ${client.program}
Started: ${client.program_started_at}

${intake ? `INTAKE DATA:
Age: ${intake.age}
Gender: ${intake.gender}
Height: ${intake.height}
Weight: ${intake.weight}
Goal: ${intake.goal}
Injuries: ${intake.injuries || 'None'}
Medical conditions: ${intake.medical_conditions || 'None'}
Diet preference: ${intake.diet_preference || 'No preference'}
Workout days: ${intake.workout_days || 5}
Workout location: ${intake.workout_location || 'Gym'}
Wake time: ${intake.wake_time || '7am'}
Sleep time: ${intake.sleep_time || '11pm'}` : 'No intake form data available.'}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || 'None'}`).join('\n')}` : 'No previous check-in data.'}

Generate the Week ${week_no} program JSON now.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssues(responseText)) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${client.name} (${client.phone})\nWeek: ${week_no}\nReason: Content matched safety filters`
      );
      return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse program JSON');
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    const pdfContent = generatePdfHtml(client, week_no, programData);
    const pdfBuffer = Buffer.from(pdfContent, 'utf-8');
    const pdfPath = `clients/${client.id}/week_${week_no}.html`;

    await supabase.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: { publicUrl } } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl,
      whatsapp_sent_at: null,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
    }).select().single();

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = programData.notes || `Your Week ${week_no} program is ready!`;
    await sendText(
      client.phone,
      `Your Week ${week_no} program is here! 🔥\n\n${contextNote}\n\nView your plan: ${publicUrl}`,
      true
    );

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function generatePdfHtml(client, weekNo, data) {
  const workoutRows = (data.workout_plan?.days || []).map(day => `
    <div class="day-card">
      <h3>${day.day} — ${day.focus}</h3>
      ${day.warmup ? `<p class="warmup">Warm-up: ${day.warmup}</p>` : ''}
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
      ${day.cooldown ? `<p class="cooldown">Cool-down: ${day.cooldown}</p>` : ''}
    </div>
  `).join('');

  const mealRows = (data.nutrition_plan?.meal_framework || []).map(m => `
    <tr><td>${m.meal}</td><td>${m.suggestion}</td><td>${m.macros || ''}</td></tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #111; color: #fff; padding: 40px 24px; }
  .header { text-align: center; margin-bottom: 48px; border-bottom: 2px solid #B8965A; padding-bottom: 32px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 3px; margin: 40px 0 20px; }
  .day-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 24px; margin-bottom: 20px; }
  .day-card h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #B8965A; letter-spacing: 2px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; background: #222; color: #B8965A; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
  td { padding: 8px 12px; border-bottom: 1px solid #222; font-size: 14px; color: #ccc; }
  .warmup, .cooldown { font-size: 13px; color: #888; margin: 8px 0; font-style: italic; }
  .macro-box { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
  .macro-item { background: #1a1a1a; border: 1px solid #B8965A; border-radius: 8px; padding: 16px 24px; text-align: center; flex: 1; min-width: 100px; }
  .macro-num { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
  .macro-label { font-size: 11px; color: #888; letter-spacing: 1px; text-transform: uppercase; margin-top: 4px; }
  .notes { background: #1a1a1a; border-left: 3px solid #B8965A; padding: 20px; margin-top: 32px; font-size: 14px; line-height: 1.7; color: #ccc; }
  .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #333; color: #555; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name} &middot; ${client.program.toUpperCase()} &middot; ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${workoutRows}
  ${data.workout_plan?.cardio ? `<p style="color:#888; margin-top:12px;">Cardio: ${data.workout_plan.cardio}</p>` : ''}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="macro-box">
    <div class="macro-item"><div class="macro-num">${data.nutrition_plan?.calories || '—'}</div><div class="macro-label">Calories</div></div>
    <div class="macro-item"><div class="macro-num">${data.nutrition_plan?.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
    <div class="macro-item"><div class="macro-num">${data.nutrition_plan?.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
    <div class="macro-item"><div class="macro-num">${data.nutrition_plan?.fat_g || '—'}g</div><div class="macro-label">Fat</div></div>
  </div>
  ${mealRows ? `<table><tr><th>Meal</th><th>Suggestion</th><th>Macros</th></tr>${mealRows}</table>` : ''}
  ${data.nutrition_plan?.hydration ? `<p style="color:#888; margin-top:12px;">Hydration: ${data.nutrition_plan.hydration}</p>` : ''}
  ${data.nutrition_plan?.supplements ? `<p style="color:#888; margin-top:8px;">Supplements: ${data.nutrition_plan.supplements}</p>` : ''}

  ${data.notes ? `<div class="notes"><strong>Coach Notes:</strong><br>${data.notes}</div>` : ''}

  <div class="footer">Fitness by Maddy &copy; ${new Date().getFullYear()} &middot; This program is personalised and confidential.</div>
</body>
</html>`;
}
