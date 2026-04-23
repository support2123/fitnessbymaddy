const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/helpers');

const MADDY_PHONE = '917082478374';

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
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

    if (!client) return res.status(404).json({ error: 'client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: leadData } = client.lead_id
      ? await supabase.from('leads').select('first_msg, market').eq('id', client.lead_id).single()
      : { data: null };

    let intakeInfo = '';
    try {
      if (leadData?.first_msg) {
        const parsed = JSON.parse(leadData.first_msg);
        intakeInfo = `
Client Profile:
- Age: ${parsed.age || 'N/A'}, Gender: ${parsed.gender || 'N/A'}
- Height: ${parsed.height || 'N/A'}, Starting Weight: ${parsed.weight || 'N/A'}
- Goal: ${parsed.goal || 'N/A'}
- Injuries: ${parsed.injuries || 'None'}
- Diet Preference: ${parsed.diet_pref || 'No preference'}
- Training Schedule: ${parsed.schedule || 'N/A'}
- Experience: ${parsed.experience || 'N/A'}
- Medical Notes: ${parsed.medical || 'None'}`;
      }
    } catch (_) {
      intakeInfo = `Client initial message: ${leadData?.first_msg || 'N/A'}`;
    }

    const checkinSummary = recentCheckins?.length
      ? recentCheckins.map(c =>
          `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'None'}`
        ).join('\n')
      : 'No previous check-ins available.';

    const prompt = `You are an expert fitness program architect for Fitness by Maddy, an elite online coaching brand.

Generate Week ${week_no} training and nutrition plan for this client.

Client: ${client.name || 'Client'}
Program: ${client.program}
${intakeInfo}

Recent Check-in Data:
${checkinSummary}

Rules:
- Be specific with exercises, sets, reps, rest times
- Include warm-up and cool-down
- Nutrition: provide daily calorie target, macro split, 3 meal ideas
- Progressive overload from previous weeks when data is available
- Adapt based on compliance score and reported issues
- NEVER recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- NEVER recommend banned substances or supplements without evidence
- Keep timelines realistic (0.5-1kg/week fat loss max)

Respond with valid JSON only:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "suggestion": "...", "calories": 450 }
    ],
    "hydration": "...",
    "supplements": "..."
  },
  "coach_note": "A 1-2 sentence motivational note for the client"
}`;

    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;

    if (hasSafetyIssue(responseText)) {
      await sendText(MADDY_PHONE,
        `⚠️ SAFETY FLAG — Program for ${client.name || maskPhone(client.phone)} Week ${week_no} contains flagged content. Review before sending.`
      );

      await supabase.from('programs').insert({
        client_id, week_no,
        workout_plan: { flagged: true, raw: responseText },
        nutrition_plan: null,
        notes: 'SAFETY FLAGGED — awaiting Maddy review',
      });

      return res.json({ ok: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (_) {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'invalid_ai_response' });
    }

    const { error: progErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null,
    });

    if (progErr) {
      console.error('Program insert error:', progErr.message);
      return res.status(500).json({ error: 'db error' });
    }

    const coachNote = parsed.coach_note || "Your new plan is ready! Let's crush this week.";
    await sendText(client.phone,
      `📋 Week ${week_no} Plan Ready!\n\n${coachNote}\n\nYour full workout + nutrition plan has been prepared. Stay consistent and trust the process! 💪`
    );

    return res.json({ ok: true, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
