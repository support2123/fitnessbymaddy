const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp, sendEscalation } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800',
  'clenbuterol', 'dnp', 'dinitrophenol', 'steroid', 'sarm',
  'lose 10 kg in 1 week', 'crash diet', 'water fast'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      .from('intake_submissions')
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

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create science-backed, personalised weekly training and nutrition plans.

RULES:
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned substances, steroids, SARMs, or dangerous supplements
- Never promise unrealistic timelines (e.g., "lose 10kg in a week")
- Tailor to the client's injuries, medical conditions, and preferences
- Be specific: exact exercises, sets, reps, rest times, and meal templates
- Output valid JSON only`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
${JSON.stringify({
  name: client.name,
  program: client.program,
  started: client.program_started_at
}, null, 2)}

INTAKE DATA:
${intake ? JSON.stringify({
  age: intake.age,
  gender: intake.gender,
  height: intake.height_cm,
  weight: intake.weight_kg,
  goal: intake.goal,
  injuries: intake.injuries,
  medical: intake.medical_conditions,
  diet: intake.diet_preference,
  days: intake.workout_days,
  location: intake.workout_location
}, null, 2) : 'No intake data available'}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? JSON.stringify(recentCheckins.map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    })), null, 2)
  : 'No check-ins yet (Week 1)'}

Return JSON with this exact structure:
{
  "workout_plan": {
    "focus": "string describing this week's focus",
    "days": [
      {
        "day": "Monday",
        "title": "e.g. Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
        ]
      }
    ],
    "cardio": "cardio prescription for the week",
    "recovery": "recovery notes"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "supplements": ["..."],
    "hydration": "string"
  },
  "coach_notes": "1-2 sentence personalized note from coach"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (parseErr) {
      console.error('JSON parse failed:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const outputStr = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => outputStr.includes(flag));
    if (flagged) {
      await sendEscalation(
        'Program safety flag — review before sending',
        client.phone,
        `Week ${week_no} program flagged for safety review`
      );
      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan || null,
        nutrition_plan: parsed.nutrition_plan || null,
        notes: 'FLAGGED FOR REVIEW: ' + (parsed.coach_notes || ''),
        pdf_url: null
      });
      return res.status(200).json({ status: 'flagged_for_review' });
    }

    const { data: program, error: insertErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || null,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.coach_notes || null
    }).select().single();

    if (insertErr) throw insertErr;

    await sendWhatsApp({
      phone: client.phone,
      message: `Your Week ${week_no} program is ready! \u{1F4CB}\n\n${parsed.coach_notes || 'New week, new gains. Let\'s go!'}\n\nCheck your program in the app or reply here if you have questions.`
    });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ status: 'ok', program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
