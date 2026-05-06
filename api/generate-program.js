const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in a week', 'lose 20 pounds in'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
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

    // Get last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get previous program for progression
    const { data: prevProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Create weekly training and nutrition plans that are:
- Evidence-based and progressive
- Tailored to the client's current metrics, compliance, and energy levels
- Safe (never prescribe below 1200 cal for women or 1500 for men)
- Realistic and sustainable

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]}
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": ["..."],
    "notes": "..."
  },
  "weekly_note": "..."
}`;

    const userPrompt = `Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Flexible'}

Recent Check-ins:
${checkins?.length ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n') : 'No check-ins yet (Week 1)'}

Previous Program Notes: ${prevProgram?.notes || 'First week - establish baseline'}

Generate Week ${week_no} program. Progress appropriately from previous weeks.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;

    // Safety check
    const lower = content.toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => lower.includes(flag));
    if (flagged) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${client.name || client.phone}\nWeek: ${week_no}\nReason: Safety keyword detected in generated program`
      );
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    // Parse the JSON response
    let programData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    // Store in programs table
    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_note || null,
      pdf_url: null
    }).select().single();

    // Send via WhatsApp
    const weekNote = programData.weekly_note || `Week ${week_no} program is ready!`;
    await sendTemplate(client.phone, 'program_ready', [weekNote]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
