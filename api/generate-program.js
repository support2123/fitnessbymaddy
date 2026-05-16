const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

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

    const anthropic = new Anthropic();
    const prompt = buildProgramPrompt(client, recentCheckins || [], lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    if (containsRiskyContent(parsed)) {
      await sendWhatsApp(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', {
        templateParams: [client.name || client.phone, `Week ${week_no} program flagged for review`]
      });
      return res.status(200).json({ flagged: true, reason: 'Content review needed' });
    }

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || parsed.workout || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || null
    }).select().single();

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', `Week ${week_no}`]
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

function buildProgramPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are an expert fitness program architect for FitnessByMaddy, a premium online coaching brand.

Generate Week ${weekNo} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

${lastProgram ? `LAST WEEK'S FOCUS: ${lastProgram.notes || 'Standard progression'}` : ''}

RULES:
- Progressive overload from last week
- Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Include rest days (minimum 1-2 per week)
- If compliance was low, simplify rather than adding volume
- If energy was low, check recovery and reduce intensity slightly

OUTPUT FORMAT (JSON):
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": "...",
    "rest_days": ["Saturday", "Sunday"]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 130,
    "carbs_g": 180,
    "fats_g": 60,
    "meal_timing": "...",
    "hydration": "3L minimum",
    "supplements": ["whey protein", "creatine 5g", "vitamin D"]
  },
  "notes": "One line context for this week's focus"
}
\`\`\``;
}

function containsRiskyContent(plan) {
  const str = JSON.stringify(plan).toLowerCase();
  const redFlags = [
    'dnp', 'clenbuterol', 'anavar', 'trenbolone', 'sarm',
    'very low calorie', 'vlcd', '800 cal', '600 cal', '500 cal',
    'starvation', 'laxative', 'purge'
  ];
  return redFlags.some(flag => str.includes(flag));
}
