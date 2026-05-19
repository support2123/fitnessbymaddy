const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish, maskPhone } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'crash diet', 'water fast',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic.default();

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
You design weekly workout and nutrition plans based on client data and check-in progress.

Rules:
- Be evidence-based and conservative. No extreme deficits below 1200 cal for women or 1500 cal for men.
- Never recommend banned substances or unrealistic timelines.
- If the client reports pain/injury, note it and reduce intensity for that area.
- Output valid JSON with two keys: "workout_plan" and "nutrition_plan".
- workout_plan: array of 5-6 training days, each with exercises, sets, reps, rest.
- nutrition_plan: object with daily_calories, protein_g, carb_g, fat_g, meal_suggestions (array of 4 meals).
- Include a "coach_notes" string with a brief motivational + technical note for the client.`;

    const userPrompt = `Client: ${client.name || 'Client'}
Program: ${client.program} (Week ${week_no})
${recentCheckins?.length ? `Recent check-ins: ${JSON.stringify(recentCheckins)}` : 'No prior check-ins yet.'}
${prevPrograms?.length ? `Previous week plan summary: ${JSON.stringify(prevPrograms[0])}` : 'First week - build a foundational program.'}

Generate the Week ${week_no} program. Return ONLY valid JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy('Program generation returned invalid JSON', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} generation failed - no valid JSON in response`,
      });
      return res.status(500).json({ error: 'Invalid program output' });
    }

    const programData = JSON.parse(jsonMatch[0]);
    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));

    if (flagged) {
      await escalateToMaddy('Program flagged for safety review', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program contains potentially unsafe content. Held for review.`,
      });
      return res.status(200).json({
        ok: true,
        held: true,
        message: 'Program held for safety review',
      });
    }

    const { error: progErr } = await db.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || null,
    }, { onConflict: 'client_id,week_no' });

    if (progErr) {
      console.error('program save error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const market = 'IN';
    const lead = await db.from('leads').select('market').eq('id', client.lead_id).single();
    const clientMarket = lead?.data?.market || market;

    const coachNote = programData.coach_notes || '';
    const msgBody = isHinglish(clientMarket)
      ? `Week ${week_no} ka plan ready hai! 💪\n\n${coachNote}\n\nPura plan aapke dashboard pe available hai.`
      : `Your Week ${week_no} plan is ready! 💪\n\n${coachNote}\n\nFull plan available on your dashboard.`;

    await sendWhatsApp(client.phone, msgBody, 'weekly_program');

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      ok: true,
      client_id,
      week_no,
      workout_days: programData.workout_plan?.length || 0,
    });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
