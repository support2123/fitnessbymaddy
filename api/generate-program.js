const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /anabolic\s*steroid/i,
  /clenbuterol/i,
  /dnp/i,
  /sarm/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*(in|per)\s*(a\s*)?week/i,
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
You create weekly workout and nutrition plans that are safe, evidence-based, and personalized.
Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan".
workout_plan: array of 7 day objects, each with "day", "focus", "exercises" (array of {name, sets, reps, rest, notes}).
nutrition_plan: object with "daily_calories", "protein_g", "carbs_g", "fat_g", "meal_plan" (array of {meal, foods, notes}).
Include a "coach_note" key with a 1-2 sentence motivational note for the client.
NEVER recommend extreme calorie restriction (<1200 cal), banned substances, or unrealistic timelines.`;

    const userPrompt = `Create Week ${week_no} program for:
Client: ${client.name || 'Client'}
Program: ${client.program}
${recentCheckins?.length ? `Recent check-ins: ${JSON.stringify(recentCheckins)}` : 'No previous check-ins.'}
${lastProgram ? `Last week plan summary: ${JSON.stringify({ notes: lastProgram.notes })}` : 'First week — build a solid foundation.'}
Progressively overload from last week if data exists. Adjust based on compliance and energy scores.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData);
    const isRisky = RISKY_PATTERNS.some(p => p.test(fullText));
    if (isRisky) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        'Risky program content detected',
        client.phone,
        `Week ${week_no} program flagged for review`
      );
      return res.json({ success: false, action: 'flagged_for_review', week_no });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || '',
    }).select().single();

    if (error) throw error;

    const market = detectMarket(client.phone);
    const coachNote = programData.coach_note || 'Your new weekly plan is ready!';
    const templateName = isHinglish(market) ? 'weekly_program_hi' : 'weekly_program';
    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      `Week ${week_no}`,
      coachNote,
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.json({ success: true, program_id: program.id, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
