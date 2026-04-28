const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');

const SAFETY_FLAGS = [
  'less than 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      try { intakeData = JSON.parse(lead?.first_msg || '{}'); } catch { intakeData = {}; }
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create personalized weekly workout and nutrition plans.

RULES:
- Never prescribe fewer than 1200 calories for women or 1500 for men
- Never recommend any banned substances, steroids, or SARMs
- Never promise unrealistic timelines (max safe fat loss: 0.5-1kg/week)
- Always include rest days (minimum 1-2 per week)
- Account for any injuries or medical conditions mentioned
- If client reports pain or concerning symptoms, flag for coach review
- Plans must be progressive (build on previous weeks)

OUTPUT FORMAT: Return valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS", "duration": "30 min" }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fats_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option A description", "Option B description"] },
      ...
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "notes": "Brief coach note about this week's focus and progression from last week",
  "flag_for_review": false
}`;

    const userPrompt = buildUserPrompt(client, intakeData, recentCheckins, lastProgram, week_no);

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
    } catch {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const outputStr = JSON.stringify(programData).toLowerCase();
    const hasSafetyIssue = SAFETY_FLAGS.some(flag => outputStr.includes(flag));

    if (hasSafetyIssue || programData.flag_for_review) {
      await escalateToMaddy(
        'Program flagged for review',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}. Reason: ${hasSafetyIssue ? 'Safety flag' : 'AI flag'}`
      );
      programData.notes = '[PENDING REVIEW] ' + (programData.notes || '');
    }

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || null,
      pdf_url: null
    }).select().single();

    if (!hasSafetyIssue && !programData.flag_for_review) {
      await sendWhatsApp(client.phone, 'weekly_program', [
        client.name || 'there',
        `Week ${week_no}`,
        programData.notes || 'Your new program is ready!'
      ]);

      await supabase.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.json({ ok: true, program_id: program.id, flagged: hasSafetyIssue || programData.flag_for_review });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, intake, checkins, lastProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;

  if (intake.age) prompt += `Age: ${intake.age}\n`;
  if (intake.gender) prompt += `Gender: ${intake.gender}\n`;
  if (intake.goal) prompt += `Goal: ${intake.goal}\n`;
  if (intake.injuries) prompt += `Injuries/Conditions: ${intake.injuries}\n`;
  if (intake.diet_pref) prompt += `Diet Preference: ${intake.diet_pref}\n`;
  if (intake.experience) prompt += `Experience: ${intake.experience}\n`;
  if (intake.schedule) prompt += `Available days: ${intake.schedule}\n`;
  if (intake.current_weight) prompt += `Starting weight: ${intake.current_weight}\n`;
  if (intake.target_weight) prompt += `Target weight: ${intake.target_weight}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    checkins.forEach(c => {
      prompt += `  Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, `;
      prompt += `Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10\n`;
      if (c.issues) prompt += `  Issues: ${c.issues}\n`;
      if (c.next_week_focus) prompt += `  Focus: ${c.next_week_focus}\n`;
    });
  }

  if (lastProgram) {
    prompt += `\nLast week's plan summary:\n`;
    prompt += `  Notes: ${lastProgram.notes || 'None'}\n`;
    if (lastProgram.nutrition_plan?.calories) {
      prompt += `  Calories: ${lastProgram.nutrition_plan.calories}\n`;
    }
  }

  prompt += `\nCreate a progressive, safe, and effective Week ${weekNo} plan. Return ONLY valid JSON.`;
  return prompt;
}
