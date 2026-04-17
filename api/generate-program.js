const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarms/i,
  /lose\s*\d{2,}\s*(kg|lbs|pounds)\s*in\s*(1|2)\s*week/i,
];

function hasSafetyRisk(text) {
  return RISKY_PATTERNS.some((p) => p.test(text));
}

const SYSTEM_PROMPT = `You are the Program Architect for FitnessByMaddy, a premium online fitness coaching brand.

Your role: Generate a weekly workout + nutrition plan customized for a specific client based on their profile and recent check-in data.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + band pull-aparts",
        "cooldown": "5 min stretching"
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "weekly_cardio": "3x 20-min moderate intensity"
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Oats + whey + banana", "Egg whites + toast"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily",
    "notes": ""
  },
  "coach_note": "Brief personalized message for the client"
}

Rules:
- Never prescribe fewer than 1400 calories for women or 1600 for men
- Never recommend banned substances or extreme protocols
- Adapt to injuries, preferences, and equipment access
- Be progressive: each week should build on the last
- Keep the tone warm, professional, and encouraging`;

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

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Unknown'}
Program: ${client.program}
Started: ${client.program_started_at}

Recent check-ins:
${checkins && checkins.length > 0
  ? checkins.map((c) =>
      `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10${c.issues ? ', Issues: ' + c.issues : ''}`
    ).join('\n')
  : 'No check-in data yet (Week 1).'
}

${prevPrograms && prevPrograms.length > 0
  ? `Previous week plan summary: ${JSON.stringify(prevPrograms[0].workout_plan?.days?.map(d => d.focus) || [])}`
  : 'First week — start with a foundational program.'
}

Generate the complete Week ${week_no} program as JSON.`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    if (hasSafetyRisk(content)) {
      await escalateToMaddy(
        'Program safety flag',
        `Client ${maskPhone(client.phone)} Week ${week_no}: AI output flagged for risky content. Review required before sending.`
      );
      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: null,
        nutrition_plan: null,
        notes: 'FLAGGED: Safety review required. Raw output stored for review.',
      });
      return res.status(200).json({ success: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      console.error('Failed to parse AI response as JSON');
      return res.status(500).json({ error: 'Invalid AI response format' });
    }

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan || null,
        nutrition_plan: parsed.nutrition_plan || null,
        notes: parsed.coach_note || null,
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Week ${week_no}`,
        parsed.coach_note || 'Your new program is ready!',
      ],
    }, true);

    if (program) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({ success: true, program_id: program?.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
