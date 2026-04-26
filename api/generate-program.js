const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { PROGRAM_NAMES } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'dnp', 'clenbuterol',
  '30 days transformation', 'lose 20kg in', 'guaranteed',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

function buildProgramPrompt(client, checkins, weekNo) {
  const lastTwo = checkins.slice(0, 2);
  const progressSummary = lastTwo.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified fitness program architect for FitnessByMaddy.
Design Week ${weekNo} of a 12-week custom training program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'unknown'}
- Goal: ${client.goal || 'general fitness'}
- Injuries/limitations: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'flexible'}
- Schedule: ${client.schedule || '5 days/week'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}

RECENT CHECK-IN DATA:
${progressSummary || 'No previous check-ins (Week 1)'}

INSTRUCTIONS:
1. Create a structured workout plan (5-6 days) with exercises, sets, reps, rest
2. Create a nutrition plan with daily calorie target, macro split, and 3 sample meals
3. Include a brief "focus note" for the week (2-3 sentences)
4. Adjust intensity based on compliance and energy scores
5. If injuries mentioned, provide safe modifications
6. NEVER recommend extreme caloric restriction (<1200 cal for women, <1500 for men)
7. NEVER recommend banned substances or unrealistic timelines

Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ]
      }
    ],
    "cardio": "description"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      {"meal": "Breakfast", "description": "..."},
      {"meal": "Lunch", "description": "..."},
      {"meal": "Dinner", "description": "..."}
    ],
    "supplements": "optional supplements if relevant"
  },
  "focus_note": "This week's focus: ..."
}`;
}

function generatePDFHTML(client, weekNo, workout, nutrition, focusNote) {
  const workoutRows = (workout.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `<h3 style="color:#B8965A;font-family:'Bebas Neue',sans-serif;font-size:18px;margin:20px 0 8px;letter-spacing:2px;">${day.day}</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
      <tr style="background:#2C2C2C;color:#B8965A;"><th style="padding:8px;text-align:left;">Exercise</th><th style="padding:8px;">Sets</th><th style="padding:8px;">Reps</th><th style="padding:8px;">Rest</th><th style="padding:8px;">Notes</th></tr>
      ${exercises}
    </table>`;
  }).join('');

  const mealRows = (nutrition.meals || []).map(m =>
    `<tr><td style="padding:8px;font-weight:600;">${m.meal}</td><td style="padding:8px;">${m.description}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',sans-serif; background:#1a1a1a; color:#FFFFFF; padding:40px; }
  .container { max-width:800px; margin:0 auto; background:#2C2C2C; border-radius:8px; overflow:hidden; }
  .header { background:linear-gradient(135deg,#1a1a1a,#2C2C2C); padding:40px; text-align:center; border-bottom:3px solid #B8965A; }
  .header h1 { font-family:'Bebas Neue',sans-serif; font-size:36px; color:#B8965A; letter-spacing:4px; }
  .header h2 { font-family:'Bebas Neue',sans-serif; font-size:22px; color:#FFFFFF; letter-spacing:2px; margin-top:8px; }
  .header p { color:#888; font-size:13px; margin-top:8px; }
  .section { padding:30px 40px; }
  .section-title { font-family:'Bebas Neue',sans-serif; font-size:24px; color:#B8965A; letter-spacing:3px; margin-bottom:16px; border-bottom:1px solid #444; padding-bottom:8px; }
  table { width:100%; border-collapse:collapse; }
  td, th { padding:8px 12px; border-bottom:1px solid #444; font-size:13px; }
  tr:nth-child(even) { background:rgba(255,255,255,0.03); }
  .macro-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:16px 0; }
  .macro-box { background:#1a1a1a; border:1px solid #444; border-radius:4px; padding:16px; text-align:center; }
  .macro-box .num { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#B8965A; }
  .macro-box .label { font-size:11px; color:#888; letter-spacing:1px; text-transform:uppercase; }
  .focus-box { background:#1a1a1a; border-left:3px solid #B8965A; padding:20px; margin:16px 0; font-size:14px; line-height:1.7; color:#ccc; }
  .footer { text-align:center; padding:24px; font-size:11px; color:#666; border-top:1px solid #444; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>WEEK ${weekNo} PROGRAM</h2>
    <p>${client.name || 'Client'} &bull; ${PROGRAM_NAMES[client.program] || client.program}</p>
  </div>

  <div class="section">
    <div class="section-title">WEEKLY FOCUS</div>
    <div class="focus-box">${focusNote || 'Stay consistent and trust the process.'}</div>
  </div>

  <div class="section">
    <div class="section-title">WORKOUT PLAN</div>
    ${workoutRows}
    ${workout.cardio ? `<p style="margin-top:12px;color:#888;font-size:13px;"><strong style="color:#B8965A;">Cardio:</strong> ${workout.cardio}</p>` : ''}
  </div>

  <div class="section">
    <div class="section-title">NUTRITION PLAN</div>
    <div class="macro-grid">
      <div class="macro-box"><div class="num">${nutrition.calories || '-'}</div><div class="label">Calories</div></div>
      <div class="macro-box"><div class="num">${nutrition.protein_g || '-'}g</div><div class="label">Protein</div></div>
      <div class="macro-box"><div class="num">${nutrition.carbs_g || '-'}g</div><div class="label">Carbs</div></div>
      <div class="macro-box"><div class="num">${nutrition.fat_g || '-'}g</div><div class="label">Fat</div></div>
    </div>
    <table style="margin-top:16px;">
      <tr style="background:#1a1a1a;"><th style="color:#B8965A;text-align:left;padding:8px;">Meal</th><th style="color:#B8965A;text-align:left;padding:8px;">Description</th></tr>
      ${mealRows}
    </table>
    ${nutrition.supplements ? `<p style="margin-top:12px;color:#888;font-size:13px;"><strong style="color:#B8965A;">Supplements:</strong> ${nutrition.supplements}</p>` : ''}
  </div>

  <div class="footer">
    &copy; Fitness by Maddy &bull; fitnessbymaddy.com &bull; This program is personalised for ${client.name || 'you'}. Do not redistribute.
  </div>
</div>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  // Get client
  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Get last 2 check-ins
  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  // Check if program already exists for this week
  const { data: existingProgram } = await db
    .from('programs')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .maybeSingle();

  if (existingProgram) {
    return res.status(200).json({ ok: true, already_exists: true, program_id: existingProgram.id });
  }

  // Call Claude API
  const anthropic = new Anthropic();
  const prompt = buildProgramPrompt(client, checkins || [], week_no);

  let programData;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');

    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  // Safety check
  const fullText = JSON.stringify(programData);
  if (hasSafetyIssue(fullText)) {
    await db.from('escalations').insert({
      phone: client.phone,
      client_id,
      reason: 'program_safety_flag',
      message_body: `Week ${week_no} program flagged for safety review`,
    });

    try {
      await sendWhatsApp(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        [maskPhone(client.phone), `Week ${week_no} program flagged — needs manual review`]
      );
    } catch (_) { /* best effort */ }

    return res.status(200).json({ ok: false, halted: true, reason: 'safety_flag' });
  }

  // Generate PDF HTML
  const pdfHTML = generatePDFHTML(
    client,
    week_no,
    programData.workout_plan || {},
    programData.nutrition_plan || {},
    programData.focus_note || ''
  );

  // Upload PDF HTML to Supabase Storage
  const pdfPath = `clients/${client_id}/week_${week_no}.html`;
  const { error: uploadError } = await db.storage
    .from('client-files')
    .upload(pdfPath, Buffer.from(pdfHTML), {
      contentType: 'text/html',
      upsert: true,
    });

  let pdfUrl = null;
  if (!uploadError) {
    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);
    pdfUrl = urlData?.publicUrl || null;
  }

  // Save to programs table
  const { data: program } = await db
    .from('programs')
    .insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.focus_note,
      pdf_url: pdfUrl,
    })
    .select()
    .single();

  // Send via WhatsApp
  if (pdfUrl) {
    try {
      const focusShort = (programData.focus_note || '').slice(0, 150);
      await sendWhatsApp(
        client.phone,
        'weekly_program',
        [client.name || 'there', `${week_no}`, focusShort],
        pdfUrl
      );
      await logMessage(client.phone, 'out', `Week ${week_no} program sent`, 'weekly_program');

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('id', program.id);
    } catch (err) {
      console.error(`Program send failed for ${maskPhone(client.phone)}:`, err.message);
    }
  }

  return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
};
