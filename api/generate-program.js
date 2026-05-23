const { getSupabase } = require('./_lib/supabase');
const { sendWhatsAppUnlimited } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/pii');

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'below 1000', 'under 800',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    if (!client) return res.status(404).json({ error: 'client not found' });

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

    const claudeApiKey = process.env.CLAUDE_API_KEY;
    if (!claudeApiKey) {
      return res.status(500).json({ error: 'CLAUDE_API_KEY not configured' });
    }

    const prompt = buildPrompt(client, recentCheckins || [], prevPrograms || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', errText);
      return res.status(502).json({ error: 'claude_api_error' });
    }

    const claudeData = await claudeRes.json();
    const rawOutput = claudeData.content?.[0]?.text || '';

    for (const flag of SAFETY_FLAGS) {
      if (rawOutput.toLowerCase().includes(flag)) {
        const { escalate } = require('./_lib/escalation');
        await escalate(client.phone, `Program safety flag: "${flag}"`, rawOutput.slice(0, 500));
        return res.status(200).json({
          ok: false,
          action: 'flagged_for_review',
          flag
        });
      }
    }

    let workoutPlan = {}, nutritionPlan = {}, notes = '';
    try {
      const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workoutPlan = parsed.workout_plan || parsed.workout || {};
        nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
        notes = parsed.notes || parsed.summary || '';
      } else {
        const parsed = JSON.parse(rawOutput);
        workoutPlan = parsed.workout_plan || parsed.workout || {};
        nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
        notes = parsed.notes || parsed.summary || '';
      }
    } catch {
      workoutPlan = { raw: rawOutput };
      notes = 'Raw output - parsing failed, manual review needed';
    }

    const { data: program, error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }).select().single();

    if (progErr) {
      console.error('Program insert error:', progErr.message);
      return res.status(500).json({ error: 'program_save_failed' });
    }

    const contextNote = notes
      ? `Week ${week_no} program ready! ${notes.slice(0, 100)}`
      : `Your Week ${week_no} program is ready! Check it out.`;

    await sendWhatsAppUnlimited(
      client.phone,
      null,
      contextNote,
      program.pdf_url || null
    );

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);

    return res.status(200).json({
      ok: true,
      program_id: program.id,
      week_no
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified personal trainer and nutrition coach creating a weekly training and nutrition program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Status: ${client.status}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'not reported'} kg
- Waist: ${lastCheckin.waist || 'not reported'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'none reported'}
` : 'No check-in data yet (first week).'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'not reported'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
` : ''}

${prevPrograms[0] ? `PREVIOUS PROGRAM NOTES: ${prevPrograms[0].notes || 'none'}` : ''}

REQUIREMENTS:
1. Create a 7-day workout plan appropriate for the client's program type and week number
2. Create a daily nutrition plan with meals, macros, and calories
3. Consider progressive overload and periodization
4. If compliance was low, simplify the plan slightly
5. If energy was low, adjust volume or intensity down
6. Address any reported issues
7. NEVER recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
8. NEVER recommend banned substances or supplements
9. Keep timelines realistic

OUTPUT as JSON with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {"day": 1, "focus": "Upper Body", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s"}]},
      ...
    ],
    "rest_days": [4, 7],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      {"meal": "Breakfast", "options": ["..."]},
      ...
    ],
    "supplements": ["..."],
    "hydration": "3-4L water daily"
  },
  "notes": "Brief summary of adjustments made this week and focus areas"
}
\`\`\``;
}
