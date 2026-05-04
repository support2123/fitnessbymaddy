const { supabase } = require('./lib/supabase');
const { sendRateLimitedToClient } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
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

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a client.
Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan".

SAFETY RULES (HARD STOPS):
- Never prescribe fewer than 1200 calories for women or 1500 for men
- Never recommend banned substances or unregulated supplements
- Never suggest extreme protocols (water fasting, 2-a-days for beginners, etc.)
- If the client reports pain/injury, reduce intensity and flag for review
- Keep realistic timelines: max 1kg fat loss per week

FORMAT for workout_plan: Array of 5-6 day objects with: { day, focus, exercises: [{ name, sets, reps, rest, notes }] }
FORMAT for nutrition_plan: { calories, protein_g, carbs_g, fat_g, meals: [{ name, foods, macros }], supplements: [], notes }`;

    const userPrompt = `CLIENT PROFILE:
Name: ${client.name}
Program: ${client.program}
Week: ${week_no} of 12

RECENT CHECK-INS:
${recentCheckins?.length ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n') : 'No previous check-ins (first week)'}

LAST PROGRAM NOTES:
${lastProgram?.notes || 'None - this is the first program'}

Generate the Week ${week_no} program. Adjust based on check-in data: if compliance is low, simplify. If energy is low, reduce volume. If weight is stalling, adjust nutrition. Progressive overload from last week where appropriate.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let programData;

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    if (programData.nutrition_plan?.calories < 1200) {
      return res.status(400).json({
        error: 'Safety halt: calories too low',
        flagged: true
      });
    }

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: `Generated for week ${week_no}. ${recentCheckins?.[0]?.issues ? 'Client issues: ' + recentCheckins[0].issues : ''}`,
        pdf_url: null
      })
      .select()
      .single();

    if (error) throw error;

    const contextNote = recentCheckins?.[0]
      ? `Based on your Week ${recentCheckins[0].week_no} check-in — ${recentCheckins[0].compliance_score >= 7 ? 'great compliance! Stepping it up.' : 'adjusted for better adherence.'}`
      : 'Your first week program is ready!';

    await sendRateLimitedToClient({
      phone: client.phone,
      templateName: 'weekly_program',
      body: `💪 Week ${week_no} Program Ready!\n\n${contextNote}\n\nCheck your program in the app. Questions? Reply here!`,
      params: { name: client.name, templateParams: [client.name, String(week_no)] }
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
