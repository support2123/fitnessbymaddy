const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { createEscalation } = require('../lib/escalation');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /sarms/i,
  /steroids?\b/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic();

    const systemPrompt = `You are Maddy's program architect for FitnessByMaddy.
You create weekly workout and nutrition plans for online coaching clients.

RULES:
- Plans must be safe, evidence-based, and appropriate for the client's level
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 kcal for men)
- Never recommend banned substances, SARMs, steroids, or dangerous supplements
- Set realistic expectations (0.5-1kg/week fat loss max)
- Adjust based on check-in data: compliance, energy, weight trends
- Format output as structured JSON

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "summary": "Brief weekly overview",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "description of weekly cardio recommendations"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fats_g": 70,
    "meal_timing": "description",
    "sample_meals": ["Meal 1: ...", "Meal 2: ..."],
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D"]
  },
  "coach_note": "1-2 sentence personalized note for the client"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No previous check-ins yet (Week 1).'}

${prevPrograms && prevPrograms.length > 0 ? `PREVIOUS PROGRAM (Week ${prevPrograms[0].week_no}):
${JSON.stringify(prevPrograms[0].workout_plan || {}, null, 2).slice(0, 500)}` : ''}

Generate a progressive, periodized program for Week ${week_no}. Adjust based on check-in data if available.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawContent = response.content[0].text;

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude response did not contain valid JSON');
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData);
    const isRisky = RISKY_PATTERNS.some(p => p.test(fullText));

    if (isRisky) {
      await createEscalation(
        client.phone,
        'risky_program_content',
        `Week ${week_no} program flagged for review. Content may contain risky recommendations.`,
        client.id
      );
      return res.json({
        ok: false,
        reason: 'flagged_for_review',
        message: 'Program flagged — awaiting Maddy review'
      });
    }

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || null
    }).select().single();

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'Champion',
      `Week ${week_no}`,
      programData.coach_note || 'New program ready!'
    ]);

    return res.json({
      ok: true,
      program_id: program.id,
      week_no
    });

  } catch (err) {
    console.error('[generate-program] Error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
