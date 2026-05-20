const Anthropic = require('@anthropic-ai/sdk').default;
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'sarm',
  'lose 10kg in 1 week', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Fetch client
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Fetch last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Build prompt
    const prompt = buildProgramPrompt(client, checkins || [], week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = message.content[0].text;

    // Safety check
    const lower = content.toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => lower.includes(flag));
    if (flagged) {
      await escalateToMaddy({
        reason: 'Program flagged for safety review',
        phone: client.phone,
        context: `Week ${week_no} program contained safety-flagged content`
      });
      return res.json({ ok: false, reason: 'flagged_for_review' });
    }

    // Parse JSON from response
    let workoutPlan, nutritionPlan, notes;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workoutPlan = parsed.workout_plan || parsed.workout;
        nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
        notes = parsed.notes || parsed.coach_notes;
      } else {
        const parsed = JSON.parse(content);
        workoutPlan = parsed.workout_plan || parsed.workout;
        nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
        notes = parsed.notes || parsed.coach_notes;
      }
    } catch {
      workoutPlan = { raw: content };
      nutritionPlan = {};
      notes = 'Raw output - manual review needed';
    }

    // Store in programs table (audit trail — REQUIRED before sending)
    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes,
        pdf_url: null
      })
      .select()
      .single();

    if (error) throw error;

    // Send via WhatsApp
    const summary = notes || `Week ${week_no} program is ready!`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'program_ready',
      params: [client.name || 'Champion', String(week_no), summary.substring(0, 200)],
      bypassRateLimit: true
    });

    // Update whatsapp_sent_at
    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a NASM-certified fitness coach creating Week ${weekNo} of a 12-week personalized program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Not specified'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}
- Program: ${client.program}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
- Focus: ${lastCheckin.next_week_focus || 'N/A'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10` : ''}

OUTPUT FORMAT — return a single JSON object:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
      ]},
      ...
    ],
    "cardio": "...",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "daily_calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": ["..."],
    "sample_meals": { "breakfast": "...", "lunch": "...", "dinner": "...", "snacks": "..." },
    "hydration": "..."
  },
  "notes": "1-2 sentence coach note for the client",
  "coach_notes": "Internal notes for Maddy's review"
}

RULES:
- Be evidence-based. No bro-science.
- Never prescribe below 1200 kcal for women or 1500 kcal for men.
- Respect injuries and limitations.
- Progressive overload from previous weeks.
- Keep it achievable based on compliance score.
- If energy is low (<=4), reduce volume and suggest deload.
- Output valid JSON only.`;
}
