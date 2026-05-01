const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');
const { maskPhone, corsHeaders } = require('./lib/utils');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'starvation', 'banned substance',
  'steroid', 'dnp', 'clenbuterol', 'ephedra', 'lose 10kg in 1 week',
  'crash diet', 'very low calorie',
];

function checkSafety(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const prompt = buildPrompt(client, recentCheckins || [], week_no);

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const generatedText = claudeData.content?.[0]?.text || '';

    if (checkSafety(generatedText)) {
      await notifyMaddy(
        'Program safety flag',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nFlagged content detected in generated program. Please review before sending.`
      );
      console.log(`[GenProgram] Safety flag for client ${client_id} week ${week_no}`);
      return res.status(200).json({ ok: true, flagged: true, message: 'Flagged for review' });
    }

    let workoutPlan, nutritionPlan;
    try {
      const parsed = JSON.parse(generatedText);
      workoutPlan = parsed.workout_plan || parsed.workout || {};
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    } catch {
      workoutPlan = { raw: generatedText };
      nutritionPlan = {};
    }

    const pdfUrl = `${client.folder_url}/week_${week_no}.pdf`;

    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      pdf_url: pdfUrl,
      notes: `Auto-generated for week ${week_no}`,
    });

    if (progErr) {
      console.error('[GenProgram] Insert error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [
        client.name || 'there',
        String(week_no),
        `Week ${week_no} program ready!`,
      ],
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    console.log(`[GenProgram] Generated week ${week_no} for client ${client_id}`);
    return res.status(200).json({ ok: true, client_id, week_no });
  } catch (err) {
    console.error('[GenProgram] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let context = `You are a NASM-certified program architect for FitnessByMaddy.
Generate a week ${weekNo} program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
`;

  if (lastCheckin) {
    context += `
LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None reported'}
`;
  }

  if (prevCheckin) {
    context += `
PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Waist: ${prevCheckin.waist || 'N/A'}
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
`;
  }

  context += `
RULES:
- Be evidence-based. No bro-science.
- Minimum 1200 kcal/day for women, 1500 kcal/day for men.
- Never recommend banned substances, extreme calorie restrictions, or unrealistic timelines.
- Adjust intensity based on compliance and energy scores.
- If compliance < 5, simplify the plan.
- If energy < 4, reduce volume and add recovery work.

OUTPUT FORMAT:
Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meal_timing": ["..."],
    "sample_meals": ["..."],
    "supplements": ["..."],
    "hydration": "..."
  }
}`;

  return context;
}
