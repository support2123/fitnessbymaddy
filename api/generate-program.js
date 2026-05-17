const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const prompt = buildProgramPrompt(client, recentCheckins, lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const programText = response.content[0].text;
    let programData;

    try {
      const jsonMatch = programText.match(/```json\n?([\s\S]*?)\n?```/);
      programData = JSON.parse(jsonMatch ? jsonMatch[1] : programText);
    } catch {
      programData = { raw: programText };
    }

    if (containsRiskyContent(programData)) {
      const { sendWhatsApp: notifyMaddy } = require('./lib/whatsapp');
      await notifyMaddy('+917082478374', 'escalation_alert', [
        'Risky program content detected',
        client.phone,
        `Week ${week_no} program flagged for review`,
      ]);
      return res.status(200).json({ action: 'flagged_for_review', client_id });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout || programData,
      nutrition_plan: programData.nutrition || null,
      notes: programData.notes || null,
    }).select().single();

    if (error) throw error;

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.notes || 'Your new plan is ready! Let\'s crush it this week 💪',
    ]);

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
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are a certified fitness program architect for FitnessByMaddy.

Client profile:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Current week: ${weekNo}

Recent check-ins:
${checkinSummary || 'No previous check-ins'}

${lastProgram ? `Last week's focus: ${lastProgram.notes || 'General progression'}` : ''}

Generate Week ${weekNo} program as JSON with this structure:
\`\`\`json
{
  "workout": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}] }
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "notes": "..."
  },
  "notes": "One-liner context for the client about this week's focus"
}
\`\`\`

Rules:
- Progressive overload from previous week
- Adjust based on compliance and energy scores
- If compliance < 5: reduce volume, keep intensity
- If energy < 4: add a deload element
- Never recommend < 1200 calories for anyone
- Never recommend banned substances or extreme protocols
- Be specific with exercise names and rep ranges`;
}

function containsRiskyContent(data) {
  const text = JSON.stringify(data).toLowerCase();
  const redFlags = [
    'steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra',
    'extreme fast', 'water cut', '500 calories', '600 calories',
    '700 calories', '800 calories',
  ];
  if (data.nutrition && data.nutrition.calories && data.nutrition.calories < 1200) {
    return true;
  }
  return redFlags.some(flag => text.includes(flag));
}
