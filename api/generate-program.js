const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'clenbuterol', 'dnp',
  'ephedrine', 'steroids', 'anabolic', 'sarms', 'hgh injection',
  'lose 10kg in 1 week', 'extreme fasting'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Get client info
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get lead data for intake info
    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('program_interest')
        .eq('id', client.lead_id)
        .single();

      if (lead?.program_interest) {
        try { intakeData = JSON.parse(lead.program_interest); } catch (e) {}
      }
    }

    // Build prompt
    const prompt = buildProgramPrompt(client, checkins || [], intakeData, week_no);

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    // Safety check
    const lowerContent = content.toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => lowerContent.includes(flag));
    if (flagged) {
      console.error(`SAFETY FLAG: Program for ${maskPhone(client.phone)} week ${week_no} contains risky content`);
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy('Risky program content flagged', client.phone, 'Auto-generated program contained safety-flagged content. Review required.');
      return res.status(200).json({ flagged: true, message: 'Program flagged for review' });
    }

    // Parse the JSON output
    let programData;
    try {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      programData = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch (e) {
      programData = { raw: content };
    }

    // Store program
    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: programData.workout || programData,
        nutrition_plan: programData.nutrition || null,
        notes: programData.notes || null
      })
      .select()
      .single();

    // Send WhatsApp notification
    await sendTemplate(client.phone, 'program_ready', [
      client.name || 'there',
      `Week ${week_no}`
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, intakeData, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program} (Week ${weekNo} of ${client.program === '12wk' ? 12 : 6})
- Goal: ${intakeData.goal || 'General fitness'}
- Injuries/Limitations: ${intakeData.injuries || 'None reported'}
- Diet Preference: ${intakeData.diet_preference || 'No preference'}
- Schedule: ${intakeData.schedule || 'Flexible'}
- Medical: ${intakeData.medical_conditions || 'None'}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
${lastCheckin.next_week_focus ? `- Focus: ${lastCheckin.next_week_focus}` : ''}` : 'No previous check-in data available.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10` : ''}

Generate a structured weekly program. Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min moderate incline walk"
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "notes": "Progressive overload focus this week"
  },
  "nutrition": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fats_g": 70,
    "meal_timing": "4 meals, pre/post workout nutrition",
    "notes": "Increase protein slightly from last week",
    "hydration": "3-4L water daily"
  },
  "notes": "Great compliance last week. Pushing volume slightly."
}
\`\`\`

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend any banned substances or supplements requiring prescription
- Keep timelines realistic (0.5-1kg loss per week max)
- Adapt based on compliance and energy scores
- If injuries mentioned, avoid aggravating movements
- Be specific with exercise names, sets, reps, and rest periods`;
}
