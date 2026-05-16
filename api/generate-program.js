const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'extreme cut', 'water fast',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified program architect for Fitness by Maddy.
Generate a weekly training + nutrition plan in JSON format.

RULES:
- Programs must be safe, evidence-based, and realistic
- Never prescribe below 1200 kcal/day for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Adjust based on check-in compliance and energy levels
- If compliance is low, simplify — don't add more volume
- Account for reported injuries or issues

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." },
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "hydration": "...",
    "supplements": [],
    "notes": ""
  },
  "weekly_focus": "...",
  "motivation_note": "..."
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Program: ${client.program}
- Started: ${client.program_started_at}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')
  : 'No check-ins yet (Week 1)'}

LAST PROGRAM NOTES:
${lastProgram ? lastProgram.notes || 'None' : 'First week — build foundation'}

Generate the complete week ${week_no} plan.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    let programData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      await notifyMaddy(`Program generation failed to parse for client ${client_id} week ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const outputStr = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => outputStr.includes(flag));
    if (flagged) {
      await notifyMaddy(`SAFETY FLAG: Generated program for client ${client_id} week ${week_no} contains risky content. Review required.`);
      return res.status(200).json({ success: false, reason: 'safety_flagged' });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_focus || '',
      pdf_url: null,
    }).select().single();

    if (error) throw error;

    const summaryMsg = `Your Week ${week_no} plan is ready! 💪\n\nFocus: ${programData.weekly_focus || 'Progressive overload'}\nCalories: ${programData.nutrition_plan?.calories || 'Custom'}kcal\n\nFull PDF coming shortly. Let's crush it!`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [summaryMsg],
    });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
