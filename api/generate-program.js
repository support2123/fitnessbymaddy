const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');
const { notifyMaddy } = require('../lib/escalation');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*\d{2,}\s*kg.*week/i,
  /extreme\s*(cut|deficit|fast)/i,
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      .select('first_msg, market')
      .eq('id', client.lead_id)
      .single();

    let intakeInfo = {};
    try { intakeInfo = JSON.parse(leadData?.first_msg || '{}'); } catch {}

    const prompt = buildPrompt(client, intakeInfo, recentCheckins || [], week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;

    if (RISKY_PATTERNS.some((p) => p.test(responseText))) {
      await notifyMaddy(
        'Risky program output',
        client.phone,
        `Week ${week_no} flagged for review. Client: ${maskPhone(client.phone)}`
      );
      return res.status(200).json({ ok: true, flagged: true, reason: 'Risky content detected — sent to Maddy for review' });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout_plan || parsed.workout;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
      notes = 'Raw output — JSON parse failed';
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
    }).select().single();

    if (error) throw error;

    const contextNote = buildContextNote(recentCheckins, week_no, leadData?.market);
    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      week_no.toString(),
      contextNote,
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ ok: true, program_id: program.id });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are Maddy's AI program architect for FitnessByMaddy. Generate a weekly fitness program.

CLIENT PROFILE:
- Name: ${client.name || 'Unknown'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Age: ${intake.age || 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Injuries/limitations: ${intake.injuries || 'None reported'}
- Diet preference: ${intake.diet_pref || 'No preference'}
- Schedule: ${intake.schedule || 'Flexible'}
- Medical: ${intake.medical_conditions || 'None'}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No check-in data yet.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

RULES:
- Generate progressive overload from previous weeks
- Calories must be safe (minimum 1400 for women, 1600 for men)
- Never recommend banned substances
- Be specific: sets, reps, rest, weights (relative)
- Include warm-up and cool-down
- Meal plan should be practical and culturally appropriate

Respond in valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "daily_calories": 0,
    "macros": { "protein_g": 0, "carbs_g": 0, "fat_g": 0 },
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coach note for the client"
}`;
}

function buildContextNote(checkins, weekNo, market) {
  const isIN = market === 'IN';
  if (!checkins || checkins.length === 0) {
    return isIN
      ? 'Week 1 ka program ready hai! Poori tarah follow karo 💪'
      : 'Your Week 1 program is ready! Follow it fully 💪';
  }
  const last = checkins[0];
  if (last.compliance_score >= 8) {
    return isIN
      ? `Zabardast compliance last week! Week ${weekNo} mein intensity badha rahe hain 🔥`
      : `Amazing compliance last week! Stepping up intensity for Week ${weekNo} 🔥`;
  }
  if (last.compliance_score <= 4) {
    return isIN
      ? `Koi nahi — is week fresh start. Ek din ek time. Week ${weekNo} program ready 💪`
      : `No worries — fresh start this week. One day at a time. Week ${weekNo} ready 💪`;
  }
  return isIN
    ? `Solid progress! Week ${weekNo} ka naya plan ready hai.`
    : `Solid progress! Your Week ${weekNo} plan is ready.`;
}
