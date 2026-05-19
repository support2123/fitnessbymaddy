const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

const DANGEROUS_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*cal/i, /extreme\s*cut/i,
  /steroid/i, /sarm/i, /dnp/i, /clenbuterol/i, /ephedra/i,
  /lose\s*10\s*kg.*week/i, /lose\s*20\s*lb.*week/i,
  /starvation/i, /water\s*fast.*week/i,
];

function isSafe(content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return !DANGEROUS_PATTERNS.some(p => p.test(text));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    let intakeData = {};
    try {
      if (lead?.first_msg) intakeData = JSON.parse(lead.first_msg);
    } catch (_) {}

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create weekly workout and nutrition plans for clients based on their profile and progress.

RULES:
- Be evidence-based, never bro-science
- Calorie floors: Women 1400 kcal, Men 1800 kcal minimum
- Never recommend banned substances, steroids, SARMs, or extreme protocols
- Progressive overload principle
- Account for injuries and medical conditions
- Realistic timelines only (0.5-1kg fat loss per week max)
- Output valid JSON only

OUTPUT FORMAT:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "frequency": "3x/week", "type": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_framework": [
      { "meal": "Breakfast", "examples": ["..."], "macros": "..." }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "weekly_focus": "...",
  "coach_notes": "..."
}`;

    const checkinSummary = (recentCheckins || []).map(c =>
      `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
    ).join('\n');

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'N/A'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intakeData.age ? `- Age: ${intakeData.age}` : ''}
${intakeData.gender ? `- Gender: ${intakeData.gender}` : ''}
${intakeData.goal ? `- Goal: ${intakeData.goal}` : ''}
${intakeData.injuries ? `- Injuries/Conditions: ${intakeData.injuries}` : ''}
${intakeData.diet_preference ? `- Diet: ${intakeData.diet_preference}` : ''}
${intakeData.equipment_access ? `- Equipment: ${intakeData.equipment_access}` : ''}
${intakeData.experience_level ? `- Experience: ${intakeData.experience_level}` : ''}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

Generate the complete Week ${week_no} program as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');

    const programData = JSON.parse(jsonMatch[0]);

    if (!isSafe(programData)) {
      await supabase.from('programs').insert({
        client_id, week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_notes,
        flagged_for_review: true,
      });
      await escalateToMaddy(
        'Program flagged for safety review',
        `Client: ${client.name} (${maskPhone(client.phone)}), Week ${week_no} — contains potentially risky content`
      );
      return res.status(200).json({ action: 'flagged_for_review' });
    }

    const { data: program } = await supabase.from('programs').upsert({
      client_id, week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || programData.weekly_focus,
      flagged_for_review: false,
    }, { onConflict: 'client_id,week_no' }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      programData.weekly_focus || `Week ${week_no} program is ready!`,
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ action: 'generated', program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
