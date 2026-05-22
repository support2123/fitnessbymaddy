const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, isHinglish, detectMarket } = require('./lib/whatsapp');

const RISKY_PATTERNS = [
  /under\s*800\s*cal/i,
  /extreme\s*(fast|cut|deficit)/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /steroids?|testosterone\s*inject/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i
];

function checkSafety(planText) {
  for (const pattern of RISKY_PATTERNS) {
    if (pattern.test(planText)) {
      return { safe: false, match: pattern.source };
    }
  }
  return { safe: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  try {
    const { data: client } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1);

    const clientProfile = {
      name: client.name,
      program: client.program,
      weekNumber: week_no,
      intake: intake?.[0] || null,
      recentCheckins: recentCheckins || []
    };

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect working for Fitness by Maddy, an elite online coaching brand. You create safe, science-backed, personalized weekly training and nutrition plans.

RULES:
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned substances, SARMs, or extreme protocols
- Never promise unrealistic timelines (e.g., "lose 10kg in 1 week")
- Always include rest days (minimum 1-2 per week)
- Scale intensity based on compliance scores and energy levels
- If client reports pain or injury, reduce volume and flag for trainer review
- All exercises must have clear descriptions

Output MUST be valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] },
      ...
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coach note for the client this week"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:
${JSON.stringify(clientProfile, null, 2)}

Adjust based on their latest check-in data. If compliance is low, simplify. If energy is high, increase intensity slightly.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const safetyCheck = checkSafety(JSON.stringify(programData));
    if (!safetyCheck.safe) {
      const { notifyMaddy } = require('./lib/whatsapp');
      await notifyMaddy(
        'Unsafe program flagged',
        `Client: ${client.name} (Week ${week_no})\nFlag: ${safetyCheck.match}`
      );
      return res.status(200).json({
        flagged: true,
        reason: safetyCheck.match,
        message: 'Program flagged for Maddy review'
      });
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
      generated_at: new Date().toISOString()
    }).select().single();

    const market = client.leads?.market || detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const contextNote = hinglish
      ? `Week ${week_no} ka program ready hai! 💪 ${programData.notes || 'Iss week full focus rakh.'}`
      : `Your Week ${week_no} program is ready! 💪 ${programData.notes || 'Stay focused this week.'}`;

    await sendWhatsApp({
      phone: client.phone,
      body: contextNote
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      programId: program.id,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
