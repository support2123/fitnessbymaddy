const { supabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /steroid/i, /sarm/i, /clenbuterol/i, /dnp/i,
  /lose\s*\d{2,}\s*kg.*week/i,
  /extreme\s*fast/i, /water\s*fast/i
];

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

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Generate a weekly training + nutrition plan based on client data and check-in history.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 65,
    "meal_timing": ["..."],
    "notes": "..."
  },
  "weekly_focus": "...",
  "motivation_note": "..."
}

Rules:
- Never suggest fewer than 1400 calories for women or 1600 for men
- Never recommend banned substances or extreme protocols
- Adapt based on compliance score and energy levels from check-ins
- Account for injuries and medical conditions
- Be progressive: increase intensity gradually week over week`;

    const userPrompt = `Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${week_no} of 12
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Flexible'}

Recent Check-ins:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : '  No previous check-ins (first week)'}

Generate Week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let programData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programJson = JSON.stringify(programData);
    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(programJson)) {
        await notifyMaddy(
          'Risky program content detected',
          `Client: ${client.name} (Week ${week_no})\nPattern: ${pattern.toString()}\nHalted auto-send. Please review.`
        );
        await supabase.from('programs').insert({
          client_id, week_no,
          workout_plan: programData.workout_plan,
          nutrition_plan: programData.nutrition_plan,
          notes: 'FLAGGED - awaiting manual review'
        });
        return res.status(200).json({ success: true, flagged: true });
      }
    }

    const { data: program } = await supabase.from('programs').insert({
      client_id, week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_focus
    }).select('id').single();

    const summaryMsg = `📋 Week ${week_no} Program Ready!\n\n` +
      `Focus: ${programData.weekly_focus || 'Progressive overload'}\n` +
      `Calories: ${programData.nutrition_plan?.calories || 'See plan'}\n` +
      `Protein: ${programData.nutrition_plan?.protein_g || 'See plan'}g\n\n` +
      `${programData.motivation_note || 'Let\'s crush this week! 💪'}\n\n` +
      `Full plan details sent to your email.`;

    await sendWhatsApp({ phone: client.phone, body: summaryMsg, templateName: 'weekly_program' });

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
