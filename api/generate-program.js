const { supabase } = require('./_lib/supabase');
const { sendWhatsAppToClient } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/market');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*cal/i, /extreme\s*cut/i,
  /clenbuterol/i, /dnp/i, /ephedra/i, /steroid/i, /sarm/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const prompt = buildPrompt(client, recentCheckins || [], prevPrograms || [], week_no);

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      console.error('CLAUDE_API_KEY not configured');
      return res.status(500).json({ error: 'AI service not configured' });
    }

    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiResult = await aiResponse.json();
    const content = aiResult.content?.[0]?.text || '';

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(content)) {
        await escalateToMaddy(
          client.phone,
          'unsafe_program_content',
          `Week ${week_no} program for ${maskPhone(client.phone)} flagged: ${pattern.toString()}`
        );
        return res.json({ ok: false, reason: 'flagged_for_review' });
      }
    }

    let workout_plan = null;
    let nutrition_plan = null;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workout_plan = parsed.workout_plan || parsed.workout || null;
        nutrition_plan = parsed.nutrition_plan || parsed.nutrition || null;
      }
    } catch (e) {
      workout_plan = { raw: content };
      nutrition_plan = { raw: content };
    }

    await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan,
      nutrition_plan,
      notes: `Auto-generated for week ${week_no}`
    });

    await sendWhatsAppToClient(
      client.phone,
      `Your Week ${week_no} program is ready! Check your plan and let's crush this week.`,
      null
    );

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.json({ ok: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  const intake = client.intake_data || {};
  const lastCheckin = checkins[0] || {};
  const prevPlan = prevPrograms[0] || {};

  return `You are a NASM-certified fitness program architect for FitnessByMaddy. Generate a personalized weekly training and nutrition plan.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Goal: ${intake.goal || 'body transformation'}
- Experience: ${intake.experience || 'intermediate'}
- Age: ${intake.age || 'N/A'}
- Injuries/Limitations: ${intake.injuries || 'None reported'}
- Diet Preference: ${intake.diet_pref || 'No preference'}
- Schedule: ${intake.schedule || '5 days/week'}

LATEST CHECK-IN (Week ${lastCheckin.week_no || 'N/A'}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}

PREVIOUS WEEK PLAN SUMMARY:
${prevPlan.workout_plan ? JSON.stringify(prevPlan.workout_plan).slice(0, 500) : 'First week - no previous plan'}

RULES:
- Be specific with exercises, sets, reps, rest periods
- Include warm-up and cool-down
- Nutrition: provide daily calorie target, macro split, and 3 meal examples
- Progressively overload from previous week if data available
- Account for any reported issues or injuries
- NEVER recommend extreme calorie deficits (below 1200 cal for women, 1500 for men)
- NEVER recommend banned substances or supplements
- NEVER promise unrealistic timelines

OUTPUT FORMAT: Return a JSON block wrapped in \`\`\`json ... \`\`\` with this structure:
{
  "workout_plan": {
    "split": "push/pull/legs" or similar,
    "days": [
      {
        "day": "Monday",
        "focus": "Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 73,
    "meals": [
      { "meal": "Breakfast", "description": "...", "calories": 550 }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["whey protein", "creatine monohydrate", "vitamin D"]
  },
  "weekly_focus": "...",
  "coach_note": "..."
}`;
}
