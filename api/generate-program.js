const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroids', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: lead } = await supabase
      .from('leads')
      .select('first_msg, market')
      .eq('id', client.lead_id)
      .single();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = {};
    try { intakeData = JSON.parse(lead?.first_msg || '{}'); } catch (e) {}

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect working for FitnessByMaddy.
Generate a weekly training and nutrition plan for a client.

RULES:
- Be evidence-based and conservative with recommendations
- Never recommend fewer than 1200 calories/day for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Consider injuries, medical conditions, and client feedback
- Output ONLY valid JSON with keys: "workout_plan" and "nutrition_plan"
- workout_plan should have keys for each training day with exercises, sets, reps, rest
- nutrition_plan should have: daily_calories, protein_g, carbs_g, fat_g, meal_suggestions (array)
- Include a "notes" field with a 1-2 sentence personalized note for the client`;

    const userPrompt = `Client: ${client.name || 'Unknown'}
Program: ${client.program}
Week: ${week_no}
Intake data: ${JSON.stringify(intakeData)}
Recent check-ins: ${JSON.stringify(recentCheckins || [])}

Generate the Week ${week_no} program. Return ONLY JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawOutput = response.content[0].text;

    if (hasSafetyIssue(rawOutput)) {
      const { createEscalation } = require('./_lib/escalation');
      await createEscalation({
        phone: client.phone,
        clientId: client_id,
        reason: 'Program generation flagged for safety review',
        messageBody: `Week ${week_no} program contained safety flags. Auto-send halted.`
      });
      return res.status(200).json({ success: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch (e) {
      console.error('Failed to parse Claude output:', e.message);
      return res.status(500).json({ error: 'Invalid program output' });
    }

    const { error: progErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || parsed,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.notes || null,
      pdf_url: null
    });

    if (progErr) {
      console.error('Program save error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const isIN = (lead?.market || 'GLOBAL') === 'IN';
    const contextNote = parsed.notes || `Week ${week_no} program ready`;
    const msg = isIN
      ? `Week ${week_no} ka program ready hai! ${contextNote}`
      : `Your Week ${week_no} program is ready! ${contextNote}`;

    await sendWhatsApp({
      phone: client.phone,
      body: msg,
      isClient: true
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
