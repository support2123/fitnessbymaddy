const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { createEscalation } = require('./_lib/escalate');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Get client profile
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Generate program via Claude
    const program = await generateWithClaude(client, checkins || [], week_no);

    if (program.flagged) {
      await createEscalation(client.phone, 'program_safety_flag', program.flagReason);

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: program.workout,
        nutrition_plan: program.nutrition,
        notes: program.notes,
        flagged_for_review: true
      });

      return res.status(200).json({ success: true, flagged: true, reason: program.flagReason });
    }

    // Generate PDF HTML (branded)
    const pdfHtml = renderProgramPdf(client, program, week_no);

    // Upload PDF HTML to storage (client renders or we use a PDF service)
    const pdfPath = `${client_id}/week_${week_no}.html`;
    await supabase.storage.from('clients').upload(pdfPath, pdfHtml, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Save to programs table
    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: program.workout,
      nutrition_plan: program.nutrition,
      notes: program.notes,
      whatsapp_sent_at: new Date().toISOString()
    });

    // Send via WhatsApp
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      program.notes || 'New week, new gains!',
      pdfUrl
    ]);

    return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generateWithClaude(client, checkins, weekNo) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  const prompt = `You are a certified fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Not specified'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

LAST CHECK-IN (Week ${lastCheckin.week_no || 'N/A'}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}

PREVIOUS CHECK-IN (Week ${prevCheckin.week_no || 'N/A'}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10

RULES:
- Never prescribe below 1200 kcal for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Adjust intensity based on compliance and energy scores
- If client reports pain or injury, reduce load on affected area
- Progressive overload: increase volume/intensity by 5-10% max per week

Return a JSON object with this exact structure:
{
  "workout": {
    "days": [
      {"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""}]},
      ...
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_plan": [
      {"meal": "Breakfast", "options": ["...", "..."]},
      ...
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-liner motivation or focus for the week",
  "flagged": false,
  "flagReason": ""
}

If anything in your recommendation could be risky (extreme deficit, injury concern, etc.), set flagged=true and explain in flagReason.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse program JSON from Claude');

  const program = JSON.parse(jsonMatch[0]);
  return program;
}

function renderProgramPdf(client, program, weekNo) {
  const workoutRows = (program.workout?.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest}</td><td>${ex.notes || ''}</td></tr>`
    ).join('');
    return `<h3>${day.day} — ${day.focus}</h3><table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead><tbody>${exercises}</tbody></table>`;
  }).join('');

  const mealRows = (program.nutrition?.meal_plan || []).map(m =>
    `<div class="meal"><strong>${m.meal}:</strong> ${(m.options || []).join(' / ')}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#fff;padding:40px 20px}
.container{max-width:800px;margin:0 auto}
h1{font-family:'Bebas Neue',sans-serif;font-size:48px;color:#D4AF7A;letter-spacing:2px;margin-bottom:8px}
h2{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#D4AF7A;margin:32px 0 16px;border-bottom:2px solid #333;padding-bottom:8px}
h3{font-size:18px;color:#fff;margin:24px 0 12px}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th{background:#2a2a2a;color:#D4AF7A;padding:10px;text-align:left;font-size:13px;text-transform:uppercase}
td{padding:10px;border-bottom:1px solid #333;font-size:14px}
.macros{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:16px 0}
.macro-box{background:#2a2a2a;border:1px solid #333;border-radius:8px;padding:16px;text-align:center}
.macro-val{font-size:28px;font-weight:600;color:#D4AF7A}
.macro-label{font-size:12px;color:#888;text-transform:uppercase;margin-top:4px}
.meal{padding:8px 0;border-bottom:1px solid #333}
.notes{background:#2a2a2a;border-left:4px solid #D4AF7A;padding:16px;margin-top:24px;border-radius:4px}
.header{text-align:center;margin-bottom:40px}
.subtitle{color:#888;font-size:14px}
</style></head><body>
<div class="container">
<div class="header">
<h1>FITNESS BY MADDY</h1>
<p class="subtitle">${client.name || 'Client'} — Week ${weekNo} Program</p>
</div>
<h2>WORKOUT PLAN</h2>
${workoutRows}
${program.workout?.cardio ? `<p style="margin-top:16px"><strong>Cardio:</strong> ${program.workout.cardio}</p>` : ''}
${program.workout?.rest_days ? `<p><strong>Rest Days:</strong> ${program.workout.rest_days}</p>` : ''}
<h2>NUTRITION PLAN</h2>
<div class="macros">
<div class="macro-box"><div class="macro-val">${program.nutrition?.calories || '—'}</div><div class="macro-label">Calories</div></div>
<div class="macro-box"><div class="macro-val">${program.nutrition?.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
<div class="macro-box"><div class="macro-val">${program.nutrition?.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
<div class="macro-box"><div class="macro-val">${program.nutrition?.fats_g || '—'}g</div><div class="macro-label">Fats</div></div>
</div>
${mealRows}
${program.nutrition?.supplements ? `<p style="margin-top:16px"><strong>Supplements:</strong> ${program.nutrition.supplements.join(', ')}</p>` : ''}
${program.nutrition?.hydration ? `<p><strong>Hydration:</strong> ${program.nutrition.hydration}</p>` : ''}
${program.notes ? `<div class="notes"><strong>This Week's Focus:</strong> ${program.notes}</div>` : ''}
</div></body></html>`;
}
