const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/whatsapp');

const RISKY_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /banned substance/i,
  /steroid/i,
  /dnp/i,
  /clenbuterol/i,
  /ephedra/i,
  /lose\s*\d{2,}\s*kg.*week/i
];

function hasDangerousContent(text) {
  return RISKY_PATTERNS.some(pattern => pattern.test(text));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect working for FitnessByMaddy.
You design safe, evidence-based, individualized weekly workout and nutrition plans.

RULES:
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned or dangerous substances
- Never promise unrealistic timelines (e.g., "lose 10kg in a week")
- Progressive overload principles for resistance training
- Account for injuries, medical conditions, and energy levels from check-ins
- Use RPE-based intensity when appropriate
- Nutrition should be practical and culturally appropriate

OUTPUT FORMAT: Return valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
      ]},
      ...
    ],
    "cardio": { "frequency": "...", "type": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fats_g": 70,
    "meal_timing": ["..."],
    "sample_meals": ["..."],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Week summary and focus points"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS (last 2 weeks):
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `  Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || 'none'}`).join('\n')
  : '  No check-ins yet (first week)'}

PREVIOUS PROGRAM:
${prevPrograms && prevPrograms.length > 0
  ? `  Week ${prevPrograms[0].week_no}: ${prevPrograms[0].notes || 'No notes'}`
  : '  No previous program (first week)'}

Design Week ${week_no} with appropriate progression. Return JSON only.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawContent = response.content[0].text;

    if (hasDangerousContent(rawContent)) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy(
        'Program generation: unsafe content detected',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nContent flagged for review`
      );
      return res.status(200).json({
        success: false,
        reason: 'flagged_for_review',
        message: 'Program flagged for Maddy review due to safety concerns'
      });
    }

    let parsed;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.notes || '',
        generated_at: new Date().toISOString()
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `${week_no}`,
        parsed.notes || `Week ${week_no} program is ready!`
      ]
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no
    });

  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
