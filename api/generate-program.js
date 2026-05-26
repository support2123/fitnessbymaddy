const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'under 800',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet', 'starvation'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeFile } = await supabase
      .storage
      .from('intake-forms')
      .download(`${client.lead_id}.json`);

    let intakeData = null;
    if (intakeFile) {
      try {
        const text = await intakeFile.text();
        intakeData = JSON.parse(text);
      } catch (e) {
        // No intake data available
      }
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for Fitness by Maddy, an elite online coaching brand. Generate a detailed, personalized weekly program.

RULES:
- Never recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines (max 1-1.5% bodyweight loss per week)
- Consider injuries and medical conditions from intake
- Progressive overload principles
- Include both workout plan and nutrition plan
- Output valid JSON only`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
Name: ${client.name}
Program: ${client.program}
Started: ${client.program_started_at}

${intakeData ? `INTAKE DATA:
Age: ${intakeData.age}
Gender: ${intakeData.gender}
Goal: ${intakeData.goal}
Injuries: ${intakeData.injuries || 'None'}
Diet Preference: ${intakeData.diet_preference || 'No preference'}
Schedule: ${intakeData.schedule || 'Flexible'}
Experience: ${intakeData.experience_level || 'Beginner'}
Current Weight: ${intakeData.current_weight || 'Unknown'}
Target Weight: ${intakeData.target_weight || 'Unknown'}
Medical: ${intakeData.medical_conditions || 'None'}` : 'No intake form submitted.'}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins.'}

Return JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "...",
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": "..."
  },
  "weekly_focus": "...",
  "coach_note": "..."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const aiText = response.content[0].text;

    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const outputText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => outputText.includes(flag));

    if (flagged) {
      await notifyMaddy('AI program flagged for safety review', {
        phone: client.phone,
        clientName: client.name,
        message: `Week ${week_no} program flagged. Review before sending.`
      });
      return res.status(200).json({
        ok: true,
        flagged: true,
        message: 'Program flagged for manual review'
      });
    }

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note || programData.weekly_focus || null,
        pdf_url: null
      })
      .select()
      .single();

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = programData.weekly_focus || `Week ${week_no} program ready!`;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      contextNote
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      ok: true,
      program_id: program.id,
      week_no,
      flagged: false
    });
  } catch (error) {
    console.error('Generate program error:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
