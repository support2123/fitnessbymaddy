const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

const RISKY_PATTERNS = [
  /below\s*\d{3,4}\s*cal/i,
  /starvation/i,
  /banned\s*substance/i,
  /steroid/i,
  /dnp/i,
  /clenbuterol/i,
  /ephedra/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i,
];

function hasSafetyIssue(text) {
  return RISKY_PATTERNS.some(p => p.test(text));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-api-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
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

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
Generate a structured weekly program based on client data.
Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan".

workout_plan: array of 7 day objects, each with:
  - day: "Monday" etc
  - focus: muscle group or rest
  - exercises: array of {name, sets, reps, rest_seconds, notes}

nutrition_plan: object with:
  - daily_calories: number
  - protein_g, carbs_g, fats_g: numbers
  - meals: array of {meal_name, time, foods: string[], macros: string}
  - hydration: string
  - supplements: string[]

Be evidence-based. No extreme calorie restrictions. No banned substances.
Adjust based on check-in data (compliance, energy, weight trends).
Tone: professional, encouraging.`;

    const userPrompt = `Client: ${client.name}
Program: ${client.program}
Week: ${week_no} of 12

Recent check-ins: ${JSON.stringify(recentCheckins || [])}
Previous program: ${JSON.stringify(prevPrograms?.[0] || 'First week')}

Generate Week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    if (hasSafetyIssue(rawText)) {
      await escalateToMaddy(
        'Program safety flag',
        `Client: ${client.name} (${maskPhone(client.phone)}) Week ${week_no} - flagged for review`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (parseErr) {
      console.error('JSON parse failed:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: `Auto-generated Week ${week_no}`
      })
      .select()
      .single();

    if (error) throw error;

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name,
      templateParams: [
        client.name,
        `Week ${week_no}`,
        'Your new program is ready! Check your email or ask me to send it again.'
      ]
    }, true);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
