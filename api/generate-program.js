const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const supabase = getSupabase();

    const client = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client.data) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.data.lead_id)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are "Program Architect" for Fitness by Maddy, an elite online coaching brand.
Generate a weekly training + nutrition plan based on the client's profile, recent check-ins, and program type.

OUTPUT FORMAT: Return valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [{"name": "", "sets": 0, "reps": "", "rest": "", "notes": ""}] },
      ...
    ],
    "cardio": { "type": "", "duration": "", "frequency": "" }
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_framework": [
      { "meal": "Meal 1", "time": "", "components": "", "example": "" },
      ...
    ],
    "hydration": "",
    "supplements": []
  },
  "notes": ""
}

RULES:
- No extreme calorie deficits (never below BMR - 300)
- No banned substances or unsafe supplement recommendations
- Adjust based on compliance score and reported issues
- Progressive overload week-to-week
- If client reports pain/injury, prescribe deload and flag for review
- Be specific with exercise selection (no vague "compound movement")`;

    const userPrompt = `Client: ${client.data.name}
Program: ${client.data.program}
Week: ${week_no} of 12

${intakeForm ? `Intake Profile:
- Age: ${intakeForm.age}
- Goal: ${intakeForm.goal}
- Injuries: ${intakeForm.injuries || 'None reported'}
- Diet preference: ${intakeForm.diet_preference || 'No restriction'}
- Schedule: ${intakeForm.schedule || 'Flexible'}
- Medical: ${intakeForm.medical_conditions || 'None'}` : 'No intake form on file.'}

${recentCheckins && recentCheckins.length > 0 ? `Recent Check-ins:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No check-ins yet (Week 1 program).'}

Generate the Week ${week_no} program. Adjust intensity based on reported compliance and energy levels.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      system: systemPrompt
    });

    const programText = response.content[0].text;

    let programData;
    try {
      const jsonMatch = programText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : programText);
    } catch (parseErr) {
      console.error('Failed to parse program JSON:', parseErr.message);
      return res.status(500).json({ error: 'Program generation produced invalid output' });
    }

    if (hasSafetyIssues(programData)) {
      await sendWhatsApp(process.env.MADDY_PHONE, 'escalation_alert', {
        templateParams: [
          `Program safety flag: ${client.data.name} (Week ${week_no})`,
          'Generated program has potential safety issues - needs manual review'
        ]
      });
      return res.status(200).json({ flagged: true, reason: 'safety_review_needed' });
    }

    const { error: insertError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.notes || null
      });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendWhatsApp(client.data.phone, 'weekly_program', {
      templateParams: [
        client.data.name || 'there',
        String(week_no),
        programData.notes || `Week ${week_no} program ready!`
      ]
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function hasSafetyIssues(programData) {
  if (!programData || !programData.nutrition_plan) return false;
  const calories = programData.nutrition_plan.calories;
  if (calories && calories < 1000) return true;
  const notes = (programData.notes || '').toLowerCase();
  const banned = ['dnp', 'clenbuterol', 'ephedra', 'sarm', 'steroid'];
  return banned.some(s => notes.includes(s));
}
