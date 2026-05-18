const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*in\s*(1|2)\s*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

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

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      return res.status(500).json({ error: 'Failed to parse Claude response' });
    }

    const fullText = JSON.stringify(parsed);
    const isUnsafe = UNSAFE_PATTERNS.some(p => p.test(fullText));

    if (isUnsafe) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy('Unsafe program content detected', {
        phone: maskPhone(client.phone),
        week_no,
        client_id,
      });
      return res.json({ success: false, reason: 'flagged_for_review' });
    }

    const { data: programRecord } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || parsed.workout || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || parsed.coach_note || '',
    }).select('id').single();

    const market = detectMarket(client.phone);
    const note = isHinglish(market)
      ? `Week ${week_no} ka program ready hai! Check kar aur questions ho toh puch.`
      : `Your Week ${week_no} program is ready! Check it out and let us know if you have questions.`;

    await sendWhatsApp(client.phone, 'weekly_program', [note, `Week ${week_no}`]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', programRecord.id);

    return res.json({ success: true, program_id: programRecord.id });
  } catch (err) {
    console.error('[generate-program]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a NASM-certified personal trainer and nutrition coach creating a weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/limitations: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}
- Week number: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

${prevProgram ? `PREVIOUS WEEK PROGRAM NOTES: ${prevProgram.notes || 'None'}` : ''}

Generate a complete weekly program. Respond ONLY with valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min steady-state"
      }
    ],
    "rest_days": ["Wednesday", "Sunday"]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": "4 meals, pre/post workout nutrition",
    "sample_meals": [
      { "meal": "Breakfast", "description": "Oats with protein powder, banana, almonds" }
    ],
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D"],
    "hydration": "3-4L water daily"
  },
  "notes": "Coach note for the client about this week's focus and adjustments"
}
\`\`\`

RULES:
- Be realistic and evidence-based
- Never recommend under 1400 calories for women or 1600 for men
- Never recommend banned substances or extreme protocols
- Adjust based on compliance and energy from check-ins
- If injuries reported, provide safe alternatives
- Progressive overload: increase volume or intensity from previous week`;
}
