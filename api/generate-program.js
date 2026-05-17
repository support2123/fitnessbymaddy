const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const prompt = buildPrompt(client, checkins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', errText);
      return res.status(500).json({ error: 'Program generation failed' });
    }

    const claudeData = await claudeRes.json();
    const content = claudeData.content[0].text;

    let programData;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      console.error('Failed to parse program JSON');
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    if (isUnsafe(programData)) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        reason: 'unsafe_program_generated',
        message_body: JSON.stringify(programData).slice(0, 500)
      });
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    const { error: insertErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan || programData.workout,
      nutrition_plan: programData.nutrition_plan || programData.nutrition,
      notes: programData.notes || null
    });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to store program' });
    }

    const market = detectMarket(client.phone);
    const contextNote = programData.notes || `Week ${week_no} program ready`;

    const msg = market === 'IN'
      ? `Week ${week_no} ka program ready hai! 💪 ${contextNote}`
      : `Your Week ${week_no} program is ready! 💪 ${contextNote}`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'program_ready',
      body: msg,
      params: [String(week_no), contextNote]
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified fitness program architect for FitnessByMaddy. Generate a weekly training and nutrition plan.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${client.goal || 'general fitness'}
- Age: ${client.age || 'unknown'}
- Injuries/limitations: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'no restrictions'}
- Schedule availability: ${client.schedule || 'flexible'}

WEEK: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'not reported'}
- Waist: ${lastCheckin.waist || 'not reported'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'none'}` : 'No previous check-in data available.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'not reported'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

RULES:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Never set unrealistic timelines (max 1kg/week fat loss)
- If the client reported pain or issues, modify exercises accordingly
- Progressive overload: slight increase from previous week
- Include rest days

OUTPUT FORMAT (respond ONLY with this JSON):
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s"}] },
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 70,
    "meal_timing": "...",
    "hydration": "3L/day",
    "supplements": ["whey protein", "creatine 5g"]
  },
  "notes": "One sentence summary for WhatsApp message"
}
\`\`\``;
}

function isUnsafe(programData) {
  const nutrition = programData.nutrition_plan || programData.nutrition || {};
  if (nutrition.calories && nutrition.calories < 1200) return true;

  const notes = (programData.notes || '').toLowerCase();
  const unsafeTerms = ['steroid', 'sarm', 'dnp', 'clenbuterol', 'ephedra', 'hgh injection'];
  if (unsafeTerms.some(t => notes.includes(t))) return true;

  const supplements = nutrition.supplements || [];
  if (supplements.some(s => unsafeTerms.some(t => s.toLowerCase().includes(t)))) return true;

  return false;
}
