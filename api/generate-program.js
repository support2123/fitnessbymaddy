const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'below 800 cal',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function checkSafety(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    let intakeData = null;
    try {
      const { data: intakeFile } = await supabase.storage
        .from('intake-forms')
        .download(`${client.lead_id}.json`);
      if (intakeFile) {
        intakeData = JSON.parse(await intakeFile.text());
      }
    } catch (_) { /* no intake form yet */ }

    const clientContext = {
      name: client.name,
      program: client.program,
      week: week_no,
      totalWeeks: client.program === '12wk' ? 12 : 6,
      checkins: recentCheckins || [],
      intake: intakeData,
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for Fitness by Maddy.
You create weekly workout and nutrition plans that are:
- Safe, evidence-based, and appropriate for the client's level
- Progressive (building on previous weeks)
- Realistic and sustainable
- Never recommending banned substances, extreme calorie deficits (<1200 cal for women, <1500 cal for men), or unrealistic timelines

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }
      ]},
      ...
    ],
    "cardio": { "frequency": "3x/week", "type": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] },
      ...
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coach note for the client (2-3 sentences, warm and motivating)"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:
${JSON.stringify(clientContext, null, 2)}

Consider their recent check-in data for progressive adjustments. If compliance was low, simplify. If energy was high, push harder.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const aiText = response.content[0].text;

    const safetyFlag = checkSafety(aiText);
    if (safetyFlag) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        reason: `AI safety flag: ${safetyFlag}`,
        message_body: `Week ${week_no} program for client ${client_id} flagged for: ${safetyFlag}`,
      });
      return res.status(200).json({ flagged: true, reason: safetyFlag });
    }

    let parsedPlan;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      parsedPlan = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsedPlan.workout_plan || null,
      nutrition_plan: parsedPlan.nutrition_plan || null,
      notes: parsedPlan.notes || null,
      pdf_url: null,
    }).select().single();

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = parsedPlan.notes || `Week ${week_no} program is ready!`;
    await sendTemplate(client.phone, 'program_ready', [
      client.name || 'there',
      String(week_no),
      contextNote,
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
