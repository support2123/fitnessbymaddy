const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, logMessage } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Never prescribe fewer than 1200 calories/day for women or 1500 for men
- Never recommend banned substances, steroids, SARMs, or any PEDs
- Never promise unrealistic timelines (max safe fat loss: 0.5-1kg/week)
- Base plans on evidence-based exercise science
- Consider injuries, limitations, and medical conditions
- Progressive overload principle for workouts
- Adequate protein (1.6-2.2g/kg bodyweight)

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Coaching notes for the client this week"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}

${intakeForm ? `INTAKE DATA:
- Age: ${intakeForm.age}
- Gender: ${intakeForm.gender}
- Goal: ${intakeForm.goal}
- Experience: ${intakeForm.experience_level}
- Injuries: ${intakeForm.injuries || 'None'}
- Diet preference: ${intakeForm.diet_preference || 'No preference'}
- Current weight: ${intakeForm.current_weight}kg
- Target weight: ${intakeForm.target_weight}kg
- Medical conditions: ${intakeForm.medical_conditions || 'None'}
- Schedule: ${intakeForm.schedule || 'Flexible'}` : 'No intake form on file.'}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins.'}

Generate the Week ${week_no} plan. Adjust based on check-in data if available.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    if (hasSafetyIssue(responseText)) {
      await sendTemplate(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        [client.name, `Week ${week_no} program flagged for safety review`]
      );
      return res.json({ status: 'flagged', reason: 'safety_review_needed' });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        workoutPlan = parsed.workout_plan;
        nutritionPlan = parsed.nutrition_plan;
        notes = parsed.notes;
      }
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const pdfHtml = generatePdfHtml(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');

    const filePath = `clients/${client_id}/week_${week_no}.html`;
    await db.storage.from('client-files').upload(filePath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: publicUrl } = db.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl.publicUrl || filePath,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
    }).select().single();

    await sendTemplate(client.phone, 'program_ready', [
      client.name || 'there',
      String(week_no),
      publicUrl.publicUrl || `https://fitnessbymaddy.com/api/program-view?id=${program.id}`,
    ]);
    await logMessage(client.phone, 'out', `Week ${week_no} program sent`, 'program_ready');

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.json({ status: 'ok', program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePdfHtml(client, weekNo, workout, nutrition, notes) {
  const workoutRows = (workout?.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name}</td>
        <td>${ex.sets} x ${ex.reps}</td>
        <td>${ex.rest}</td>
        <td>${ex.notes || ''}</td>
      </tr>`
    ).join('');
    return `<h3 style="color:#B8965A;margin:24px 0 8px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;">${day.day} — ${day.focus}</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead><tr style="background:#2C2C2C;color:white;text-align:left;">
        <th style="padding:8px 12px;">Exercise</th>
        <th style="padding:8px 12px;">Sets x Reps</th>
        <th style="padding:8px 12px;">Rest</th>
        <th style="padding:8px 12px;">Notes</th>
      </tr></thead>
      <tbody>${exercises}</tbody>
    </table>`;
  }).join('');

  const mealRows = (nutrition?.meals || []).map(m =>
    `<tr><td style="padding:8px 12px;font-weight:600;">${m.meal}</td><td style="padding:8px 12px;">${(m.options || []).join(', ')}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;600&display=swap" rel="stylesheet">
<style>
  body { font-family:'DM Sans',sans-serif; background:#FAF8F4; color:#2C2C2C; margin:0; padding:40px; }
  .header { background:#2C2C2C; color:white; padding:32px 40px; margin:-40px -40px 32px; }
  .header h1 { font-family:'Bebas Neue',sans-serif; font-size:36px; letter-spacing:3px; margin:0; color:#B8965A; }
  .header p { color:rgba(255,255,255,0.6); margin:8px 0 0; font-size:14px; }
  table { width:100%; border-collapse:collapse; }
  td, th { padding:8px 12px; border-bottom:1px solid #E8E3DC; font-size:14px; }
  tbody tr:hover { background:#F0EAE0; }
  .macro-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:16px 0; }
  .macro-box { background:white; border:1px solid #E8E3DC; padding:16px; text-align:center; border-radius:4px; }
  .macro-box .val { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#B8965A; }
  .macro-box .label { font-size:11px; color:#6B6B6B; text-transform:uppercase; letter-spacing:1px; }
  .notes { background:#2C2C2C; color:white; padding:24px; border-radius:4px; margin-top:24px; }
  .notes p { color:rgba(255,255,255,0.8); line-height:1.7; }
</style>
</head><body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <p>${client.name} — Week ${weekNo} Program</p>
  </div>

  <h2 style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:2px;color:#2C2C2C;">WORKOUT PLAN</h2>
  ${workoutRows}
  ${workout?.cardio ? `<p style="margin:16px 0;color:#6B6B6B;"><strong>Cardio:</strong> ${workout.cardio.type} — ${workout.cardio.frequency}, ${workout.cardio.duration}</p>` : ''}

  <h2 style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:2px;color:#2C2C2C;margin-top:40px;">NUTRITION PLAN</h2>
  <div class="macro-grid">
    <div class="macro-box"><div class="val">${nutrition?.calories || '—'}</div><div class="label">Calories</div></div>
    <div class="macro-box"><div class="val">${nutrition?.protein_g || '—'}g</div><div class="label">Protein</div></div>
    <div class="macro-box"><div class="val">${nutrition?.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
    <div class="macro-box"><div class="val">${nutrition?.fat_g || '—'}g</div><div class="label">Fat</div></div>
  </div>
  <table><thead><tr style="background:#2C2C2C;color:white;"><th style="padding:8px 12px;text-align:left;">Meal</th><th style="padding:8px 12px;text-align:left;">Options</th></tr></thead>
  <tbody>${mealRows}</tbody></table>
  ${nutrition?.supplements ? `<p style="margin:16px 0;color:#6B6B6B;"><strong>Supplements:</strong> ${nutrition.supplements.join(', ')}</p>` : ''}
  ${nutrition?.hydration ? `<p style="color:#6B6B6B;"><strong>Hydration:</strong> ${nutrition.hydration}</p>` : ''}

  ${notes ? `<div class="notes"><h3 style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:#B8965A;letter-spacing:2px;margin:0 0 12px;">COACH'S NOTES</h3><p>${notes}</p></div>` : ''}

  <p style="text-align:center;margin-top:40px;font-size:12px;color:#6B6B6B;letter-spacing:1px;">FITNESS BY MADDY &mdash; fitnessbymaddy.com</p>
</body></html>`;
}
