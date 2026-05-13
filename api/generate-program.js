const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

const RISKY_KEYWORDS = [
  'below 1000 calories', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in 2 weeks',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db
      .from('programs')
      .select('workout_plan,nutrition_plan,notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's AI program architect for FitnessByMaddy. You create weekly personalised workout and nutrition plans.

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines (e.g., "lose 10kg in 1 week")
- Base progression on the client's check-in data
- If the client reports pain or injury, reduce intensity and flag for review
- Output valid JSON only with keys: workout_plan, nutrition_plan, notes`;

    const userPrompt = `Create Week ${week_no} program for this client:

Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

Recent Check-ins (most recent first):
${recentCheckins?.length ? recentCheckins.map(c =>
  `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues: ${c.issues || 'None'}`
).join('\n') : 'No check-ins yet (Week 1)'}

${lastProgram ? `Last week's program notes: ${lastProgram.notes || 'None'}` : ''}

Return a JSON object with:
- workout_plan: object with days (day1-day6, day7=rest) each containing exercises array with {name, sets, reps, rest, notes}
- nutrition_plan: object with {calories, protein_g, carbs_g, fat_g, meals: [{name, foods, macros}]}
- notes: string with key focus areas for this week`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    if (RISKY_KEYWORDS.some(kw => responseText.toLowerCase().includes(kw))) {
      const { notifyMaddy } = require('../lib/escalation');
      await notifyMaddy('Risky program content flagged', {
        phone: client.phone,
        name: client.name,
        week: week_no,
      });
      return res.status(200).json({ flagged: true, reason: 'Risky content detected, sent for Maddy review' });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('[generate-program] Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
    });

    if (insertErr) {
      console.error('[generate-program] DB insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const market = client.market || 'GLOBAL';
    const contextNote = isHinglish(market)
      ? [`Week ${week_no} ka program ready hai! Focus: ${(programData.notes || '').slice(0, 100)}`]
      : [`Your Week ${week_no} program is ready! Focus: ${(programData.notes || '').slice(0, 100)}`];

    await sendWhatsApp(client.phone, 'weekly_program', contextNote);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('[generate-program]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
