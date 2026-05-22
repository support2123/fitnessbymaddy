const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
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

    const prompt = buildPrompt(client, recentCheckins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const rawOutput = claudeData.content?.[0]?.text || '';

    if (hasSafetyIssue(rawOutput)) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation({
        sourceType: 'program_generation',
        sourceId: client_id,
        phone: client.phone,
        reason: 'safety_flag',
        details: 'Generated program contained safety-flagged content. Review before sending.'
      });
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    let workoutPlan = {};
    let nutritionPlan = {};
    try {
      const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workoutPlan = parsed.workout || parsed.workout_plan || {};
        nutritionPlan = parsed.nutrition || parsed.nutrition_plan || {};
      }
    } catch {
      workoutPlan = { raw: rawOutput };
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: rawOutput.slice(0, 500)
    }).select().single();

    await sendWhatsApp({
      phone: client.phone,
      body: `Your Week ${week_no} program is ready! Check your email for the full plan. Key focus: ${(program.notes || '').slice(0, 200)}`,
      isClient: true
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are a NASM-certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

INSTRUCTIONS:
1. Create a complete 7-day workout plan (appropriate to their program)
2. Create a nutrition plan with daily calorie target, macros, and sample meals
3. Adjust based on their check-in data (compliance, energy, issues)
4. Keep it realistic, safe, and progressive
5. Never prescribe below 1200 calories for women or 1500 for men
6. Never recommend any supplements beyond basic protein/creatine/multivitamin
7. If they reported pain/injury, reduce load on affected area

OUTPUT FORMAT: Return a JSON block wrapped in \`\`\`json ... \`\`\` with this structure:
{
  "workout": {
    "monday": { "name": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s"}] },
    ...
  },
  "nutrition": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] },
      ...
    ]
  },
  "coach_notes": "Brief note about this week's focus"
}`;
}
