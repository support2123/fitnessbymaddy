const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories',
  'below 800 calories',
  'very low calorie',
  'crash diet',
  'clenbuterol',
  'dnp',
  'ephedrine',
  'anabolic',
  'steroid',
  'lose 10kg in 1 week',
  'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are the program architect for FitnessByMaddy, an elite online fitness coaching brand.
You design weekly workout and nutrition plans that are:
- Evidence-based and safe
- Progressive (building on previous weeks)
- Tailored to the client's profile, goals, and check-in feedback
- Never extreme (no sub-1200 cal diets, no dangerous exercises for their level)

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
        ],
        "cardio": "..."
      }
    ],
    "rest_days": ["Sunday"],
    "weekly_volume_notes": "..."
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "hydration": "...",
    "supplements": ["..."],
    "notes": "..."
  },
  "coach_note": "Short motivational + tactical note for the client"
}`;

    const userPrompt = buildClientPrompt(client, recentCheckins, prevPrograms, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const program = JSON.parse(jsonMatch[0]);

    const contentStr = JSON.stringify(program).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (contentStr.includes(flag)) {
        await db.from('escalations').insert({
          phone: client.phone,
          client_id,
          reason: `Safety flag in generated program: "${flag}"`,
          message_body: `Week ${week_no} program flagged for review`,
        });
        return res.status(200).json({
          success: false,
          flagged: true,
          reason: flag,
        });
      }
    }

    const { data: saved } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: program.coach_note,
      })
      .select('id')
      .single();

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      program.coach_note || 'New program ready!',
    ]);

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', saved.id);

    return res.status(200).json({ success: true, program_id: saved.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildClientPrompt(client, checkins, prevPrograms, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `**Profile:**\n`;
  prompt += `- Name: ${client.name || 'N/A'}\n`;
  prompt += `- Program: ${client.program}\n`;
  prompt += `- Goal: ${client.goal || 'General fitness'}\n`;
  prompt += `- Age: ${client.age || 'N/A'}\n`;
  prompt += `- Injuries/Conditions: ${client.injuries || 'None reported'}\n`;
  prompt += `- Diet Preference: ${client.diet_pref || 'No restrictions'}\n`;
  prompt += `- Schedule: ${client.schedule || 'Flexible'}\n\n`;

  if (checkins?.length) {
    prompt += `**Recent Check-ins:**\n`;
    for (const ci of checkins) {
      prompt += `- Week ${ci.week_no}: Weight ${ci.weight || '?'}kg, `;
      prompt += `Waist ${ci.waist || '?'}cm, `;
      prompt += `Compliance ${ci.compliance_score || '?'}/10, `;
      prompt += `Energy ${ci.energy || '?'}/10`;
      if (ci.issues) prompt += `, Issues: ${ci.issues}`;
      prompt += `\n`;
    }
    prompt += '\n';
  }

  if (prevPrograms?.length) {
    const prev = prevPrograms[0];
    prompt += `**Previous Week ${prev.week_no} Plan Summary:**\n`;
    prompt += `Workout: ${JSON.stringify(prev.workout_plan).slice(0, 500)}\n`;
    prompt += `Nutrition: ${JSON.stringify(prev.nutrition_plan).slice(0, 500)}\n\n`;
  }

  prompt += `Make appropriate progressions based on check-in data. If compliance is low, simplify. If energy is low, reduce volume slightly. Ensure progressive overload where compliance is high.`;

  return prompt;
}
