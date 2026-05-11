const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
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
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(client, intake, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;
    let programData;

    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      await escalateToMaddy('Program generation parse failure', {
        phone: client.phone,
        message: `Week ${week_no} program generation failed to parse`,
      });
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    if (isSafetyFlagged(programData)) {
      await escalateToMaddy('Program flagged for safety review', {
        phone: client.phone,
        message: `Week ${week_no} program flagged: possible extreme protocol`,
      });
      return res.status(200).json({ action: 'flagged_for_review', client_id, week_no });
    }

    const pdfHtml = renderProgramPdf(client, programData, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.html`;
    await supabase.storage.from('programs').upload(pdfPath, pdfHtml, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: publicUrl } = supabase.storage.from('programs').getPublicUrl(pdfPath);

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl.publicUrl,
      workout_plan: programData.workout_plan || programData.workout,
      nutrition_plan: programData.nutrition_plan || programData.nutrition,
      notes: programData.notes || programData.coach_note || null,
    });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = programData.notes || programData.coach_note || `Week ${week_no} program ready!`;

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      contextNote.substring(0, 200),
      publicUrl.publicUrl,
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ action: 'program_generated', client_id, week_no, url: publicUrl.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildSystemPrompt() {
  return `You are "Program Architect" — an expert fitness coach AI working for Fitness by Maddy.
You create weekly customised workout and nutrition plans for clients.

Rules:
- Base everything on the client's profile, recent check-ins, and progression data
- Never prescribe extreme calorie deficits below 1200 kcal for women or 1500 kcal for men
- Never recommend banned substances or steroids
- Never set unrealistic timelines (e.g., "lose 10kg in 1 week")
- For PCOS clients: prioritise hormonal balance, stress management, anti-inflammatory foods
- For 40+ clients: prioritise joint health, mobility, recovery
- Progressive overload: increase volume/intensity by 5-10% weekly max
- Include deload every 4th week
- Always provide exercise alternatives for common equipment limitations

Output format: Return a JSON object with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [...] }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meal_framework": [...],
    "hydration_note": "...",
    "supplements": []
  },
  "notes": "One-liner coach context note for the client"
}

Each exercise object: { "name": "...", "sets": 3, "reps": "8-12", "rest_sec": 90, "notes": "..." }`;
}

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `**Client:** ${client.name || 'Anonymous'}\n`;
  prompt += `**Program:** ${client.program}\n`;
  prompt += `**Started:** ${client.program_started_at}\n\n`;

  if (intake) {
    prompt += `**Intake Data:**\n`;
    prompt += `- Age: ${intake.age || 'N/A'}, Gender: ${intake.gender || 'N/A'}\n`;
    prompt += `- Height: ${intake.height || 'N/A'}, Weight: ${intake.weight || 'N/A'}kg\n`;
    prompt += `- Goal: ${intake.goal || 'General fitness'}\n`;
    prompt += `- Injuries: ${intake.injuries || 'None reported'}\n`;
    prompt += `- Diet preference: ${intake.diet_preference || 'No restrictions'}\n`;
    prompt += `- Experience: ${intake.experience_level || 'Intermediate'}\n`;
    prompt += `- Schedule: ${intake.workout_schedule || '5 days/week'}\n\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `**Recent Check-ins:**\n`;
    for (const ci of checkins) {
      prompt += `- Week ${ci.week_no}: Weight ${ci.weight || 'N/A'}kg, Waist ${ci.waist || 'N/A'}cm, `;
      prompt += `Compliance ${ci.compliance_score || 'N/A'}/10, Energy ${ci.energy || 'N/A'}/10\n`;
      if (ci.issues) prompt += `  Issues: ${ci.issues}\n`;
    }
    prompt += `\n`;
  }

  if (weekNo > 1) {
    prompt += `Adjust this week's plan based on their check-in data. `;
    if (weekNo % 4 === 0) {
      prompt += `This is a DELOAD week — reduce volume by 40% and intensity by 20%.`;
    } else {
      prompt += `Progress from last week with appropriate overload.`;
    }
  }

  return prompt;
}

function isSafetyFlagged(programData) {
  const nutrition = programData.nutrition_plan || programData.nutrition || {};
  const calories = nutrition.calories || nutrition.total_calories || 2000;

  if (calories < 1200) return true;

  const notes = JSON.stringify(programData).toLowerCase();
  const flagWords = ['steroid', 'sarm', 'dnp', 'clenbuterol', 'ephedrine', 'hgh injection'];
  if (flagWords.some(w => notes.includes(w))) return true;

  return false;
}

function renderProgramPdf(client, programData, weekNo) {
  const workout = programData.workout_plan || programData.workout || {};
  const nutrition = programData.nutrition_plan || programData.nutrition || {};
  const days = workout.days || [];

  let exerciseHtml = '';
  for (const day of days) {
    exerciseHtml += `<div class="day-block">
      <h3>${day.day} — ${day.focus}</h3>
      <table><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th></tr>`;
    for (const ex of (day.exercises || [])) {
      exerciseHtml += `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest_sec || 60}s</td></tr>`;
    }
    exerciseHtml += `</table></div>`;
  }

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#fff;padding:40px 24px}
.header{text-align:center;margin-bottom:48px;padding-bottom:32px;border-bottom:2px solid #B8965A}
.header h1{font-family:'Bebas Neue',sans-serif;font-size:48px;color:#B8965A;letter-spacing:4px}
.header h2{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#fff;margin-top:8px}
.header p{color:#999;margin-top:8px;font-size:14px}
.section{margin-bottom:40px}
.section h2{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A;margin-bottom:16px;letter-spacing:2px}
.day-block{background:#222;border-radius:8px;padding:24px;margin-bottom:16px;border-left:4px solid #B8965A}
.day-block h3{font-size:18px;color:#B8965A;margin-bottom:12px}
table{width:100%;border-collapse:collapse}
th,td{padding:10px 12px;text-align:left;font-size:14px;border-bottom:1px solid #333}
th{color:#B8965A;font-size:12px;text-transform:uppercase;letter-spacing:1px}
.nutrition{background:#222;border-radius:8px;padding:32px;border-left:4px solid #B8965A}
.macro-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:20px 0}
.macro{text-align:center;padding:16px;background:#1a1a1a;border-radius:8px}
.macro .value{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A}
.macro .label{font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
.coach-note{background:linear-gradient(135deg,#2a2a1a,#1a1a1a);border:1px solid #B8965A;border-radius:8px;padding:24px;margin-top:32px;font-style:italic;color:#D4AF7A}
.footer{text-align:center;margin-top:48px;padding-top:24px;border-top:1px solid #333;color:#666;font-size:12px}
@media(max-width:600px){.macro-grid{grid-template-columns:repeat(2,1fr)}}
</style></head><body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <h2>Week ${weekNo} Program</h2>
  <p>${client.name || 'Client'} | ${programDisplayName(client.program)}</p>
</div>
<div class="section">
  <h2>Workout Plan</h2>
  ${exerciseHtml}
  ${workout.rest_days ? `<p style="color:#999;margin-top:12px">Rest days: ${workout.rest_days.join(', ')}</p>` : ''}
</div>
<div class="section">
  <h2>Nutrition Plan</h2>
  <div class="nutrition">
    <div class="macro-grid">
      <div class="macro"><div class="value">${nutrition.calories || '—'}</div><div class="label">Calories</div></div>
      <div class="macro"><div class="value">${nutrition.protein_g || '—'}g</div><div class="label">Protein</div></div>
      <div class="macro"><div class="value">${nutrition.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
      <div class="macro"><div class="value">${nutrition.fats_g || '—'}g</div><div class="label">Fats</div></div>
    </div>
    ${nutrition.hydration_note ? `<p style="color:#999;margin-top:12px">${nutrition.hydration_note}</p>` : ''}
  </div>
</div>
${programData.notes ? `<div class="coach-note"><strong>Coach Note:</strong> ${programData.notes}</div>` : ''}
<div class="footer">Fitness by Maddy | fitnessbymaddy.com | This program is personalised — do not share.</div>
</body></html>`;
}

function programDisplayName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Shred',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack',
  };
  return names[program] || program;
}
