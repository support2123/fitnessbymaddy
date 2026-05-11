const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

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
      .select('intake_data, program_interest')
      .eq('id', client.lead_id)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], leadData, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;
    const parsed = parseProgram(content);

    if (parsed.flagged) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy('unsafe_program', client.phone, parsed.flagReason);
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    const pdfHtml = renderProgramPDF(client, parsed, week_no);
    const pdfPath = `${client_id}/week_${week_no}.html`;

    await supabase.storage
      .from('clients')
      .upload(pdfPath, Buffer.from(pdfHtml), {
        contentType: 'text/html',
        upsert: true,
      });

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);

    const { error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData.publicUrl,
      workout_plan: parsed.workout,
      nutrition_plan: parsed.nutrition,
      notes: parsed.notes,
    });

    if (error) throw error;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [client.name || 'Champion', `Week ${week_no}`, parsed.notes || 'Lets go!'],
      mediaUrl: urlData.publicUrl,
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, leadData, weekNo) {
  const intake = leadData?.intake_data || {};
  const lastCheckin = checkins[0] || {};

  return `You are a NASM-certified fitness program architect for FitnessByMaddy.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program} (Week ${weekNo} of ${client.program === '12wk' ? 12 : 6})
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || leadData?.program_interest || 'general fitness'}
- Injuries/Limitations: ${intake.injuries || 'none reported'}
- Diet Preference: ${intake.diet_preference || 'flexible'}
- Schedule: ${intake.schedule || '5 days/week'}
- Experience: ${intake.experience_level || 'intermediate'}

LATEST CHECK-IN DATA:
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'none'}
- Focus from last week: ${lastCheckin.next_week_focus || 'N/A'}

RULES:
1. Never prescribe below 1200 kcal for women or 1500 kcal for men
2. Never recommend banned/unregulated supplements
3. Never promise specific weight loss timelines
4. If injuries mentioned, modify exercises accordingly
5. Progressive overload must be gradual and safe

Generate a complete weekly program in this JSON format:
{
  "workout": {
    "days": [
      {"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""}]}
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 60,
    "meals": [{"meal": "Breakfast", "example": "...", "calories": 400}],
    "hydration": "3L water daily",
    "supplements": ["whey protein", "creatine 5g"]
  },
  "notes": "One-liner context/motivation for the client",
  "flagged": false,
  "flagReason": ""
}

Respond ONLY with valid JSON.`;
}

function parseProgram(content) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {}
  return { workout: {}, nutrition: {}, notes: 'Program generated', flagged: false };
}

function renderProgramPDF(client, program, weekNo) {
  const workoutDays = program.workout?.days || [];
  const nutrition = program.nutrition || {};

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program - ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
.header { text-align: center; padding: 40px 0; border-bottom: 2px solid #B8965A; margin-bottom: 40px; }
.header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
.header p { color: #888; font-size: 14px; margin-top: 8px; }
.section { margin-bottom: 40px; }
.section h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #B8965A; margin-bottom: 16px; letter-spacing: 2px; }
.day-card { background: #2a2a2a; border-radius: 8px; padding: 24px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
.day-card h3 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
.exercise { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #333; font-size: 14px; }
.exercise:last-child { border-bottom: none; }
.exercise .name { color: #ddd; }
.exercise .detail { color: #B8965A; }
.nutrition-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.macro-card { background: #2a2a2a; padding: 20px; border-radius: 8px; text-align: center; }
.macro-card .num { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; }
.macro-card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
.footer { text-align: center; padding-top: 40px; border-top: 1px solid #333; color: #666; font-size: 12px; }
</style>
</head>
<body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <p>Week ${weekNo} Program for ${client.name || 'Client'}</p>
</div>

<div class="section">
  <h2>WORKOUT PLAN</h2>
  ${workoutDays.map(day => `
  <div class="day-card">
    <h3>${day.day} — ${day.focus}</h3>
    ${(day.exercises || []).map(ex => `
    <div class="exercise">
      <span class="name">${ex.name}</span>
      <span class="detail">${ex.sets} × ${ex.reps} | Rest: ${ex.rest}</span>
    </div>`).join('')}
  </div>`).join('')}
</div>

<div class="section">
  <h2>NUTRITION PLAN</h2>
  <div class="nutrition-grid">
    <div class="macro-card"><div class="num">${nutrition.calories || '-'}</div><div class="label">Calories</div></div>
    <div class="macro-card"><div class="num">${nutrition.protein_g || '-'}g</div><div class="label">Protein</div></div>
    <div class="macro-card"><div class="num">${nutrition.carbs_g || '-'}g</div><div class="label">Carbs</div></div>
    <div class="macro-card"><div class="num">${nutrition.fats_g || '-'}g</div><div class="label">Fats</div></div>
  </div>
  ${(nutrition.meals || []).map(m => `
  <div class="day-card">
    <h3>${m.meal} (~${m.calories} kcal)</h3>
    <p style="color:#aaa;font-size:14px">${m.example}</p>
  </div>`).join('')}
</div>

${program.notes ? `<div class="section"><h2>COACH'S NOTE</h2><p style="color:#ccc;font-size:16px;line-height:1.6">${program.notes}</p></div>` : ''}

<div class="footer">
  <p>© Fitness by Maddy | fitnessbymaddy.com | This program is personalized — do not share.</p>
</div>
</body>
</html>`;
}
