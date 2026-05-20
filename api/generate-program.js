const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme calorie',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet'
];

function checkSafety(text) {
  const lower = (text || '').toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const { data: leadData } = client.lead_id
      ? await supabase.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const anthropic = new Anthropic();

    const checkinSummary = (recentCheckins || []).map(c =>
      `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    ).join('\n');

    const prompt = `You are a NASM-certified fitness program architect for Fitness by Maddy.

Client profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
- Intake data: ${JSON.stringify(leadData?.intake_data || {})}

Recent check-ins:
${checkinSummary || 'No previous check-ins available (Week 1)'}

Generate a detailed weekly program in JSON format with two keys:
1. "workout_plan": Array of 5-6 training days, each with:
   - "day": day name
   - "focus": muscle group / type
   - "exercises": array of { "name", "sets", "reps", "rest_seconds", "notes" }
   - "warmup": string
   - "cooldown": string

2. "nutrition_plan": Object with:
   - "daily_calories": number
   - "protein_g": number
   - "carbs_g": number
   - "fats_g": number
   - "meal_timing": array of { "meal", "time", "description", "macros" }
   - "hydration": string
   - "supplements": array of strings

3. "notes": 1-2 sentence coach's note for the client, warm and motivating

Rules:
- Base progression on check-in data (increase/decrease volume/intensity)
- Never suggest calories below 1200 for women or 1500 for men
- Never suggest banned substances or extreme protocols
- Include proper rest days
- Tailor to injuries/conditions from intake data
- Output valid JSON only, no markdown wrapping`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content[0].text;

    const safetyIssue = checkSafety(responseText);
    if (safetyIssue) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        reason: `Program safety flag: ${safetyIssue}`,
        message: `Week ${week_no} program for client ${maskPhone(client.phone)} flagged for review`
      });
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        flag: safetyIssue
      });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes || null
    }).select().single();

    if (error) throw error;

    const contextNote = parsed.notes || `Here's your Week ${week_no} program!`;
    await sendWhatsApp(client.phone, null, {
      text: `Week ${week_no} Program Ready!\n\n${contextNote}\n\nYour full workout & nutrition plan has been generated. Check your program folder for details.`,
      isClient: true,
      skipRateLimit: true
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`[Program] Generated week ${week_no} for ${maskPhone(client.phone)}`);
    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('[Program] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
