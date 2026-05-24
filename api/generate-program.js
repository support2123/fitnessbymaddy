const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeFile } = await supabase.storage
      .from('intake-forms')
      .download(`${client.lead_id}.json`);

    let intakeData = null;
    if (intakeFile) {
      try {
        intakeData = JSON.parse(await intakeFile.text());
      } catch (e) {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You design personalized weekly workout and nutrition plans.

RULES:
- Never prescribe extreme calorie deficits below 1200 kcal for women or 1500 kcal for men
- Never recommend banned substances or supplements requiring medical supervision
- Never set unrealistic timelines (max 1kg/week fat loss)
- Include progressive overload principles
- Account for injuries and medical conditions
- Provide alternatives for exercises when applicable

Output valid JSON with this structure:
{
  "workout_plan": {
    "days": [{"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": N, "reps": "...", "rest": "..."}]}],
    "cardio": "...",
    "deload_notes": "..."
  },
  "nutrition_plan": {
    "calories": N,
    "protein_g": N,
    "carbs_g": N,
    "fats_g": N,
    "meal_timing": "...",
    "sample_meals": ["..."],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "...",
  "next_week_focus": "..."
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Program: ${client.program}
- Started: ${client.program_started_at}
${intakeData ? `- Goal: ${intakeData.goal}
- Age: ${intakeData.age}
- Gender: ${intakeData.gender}
- Equipment: ${intakeData.equipment}
- Workout days: ${intakeData.workout_days}
- Injuries: ${intakeData.injuries || 'None'}
- Diet preference: ${intakeData.diet_pref}
- Current weight: ${intakeData.current_weight}
- Target weight: ${intakeData.target_weight}` : ''}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0 ? recentCheckins.map(c =>
  `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`
).join('\n') : 'No check-ins yet (Week 1)'}

Design an appropriate Week ${week_no} plan considering progression from previous weeks.`;

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
    } catch (parseErr) {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Program generation failed — invalid output' });
    }

    const safetyCheck = validateProgram(programData);
    if (!safetyCheck.safe) {
      const { notifyMaddy } = require('./lib/whatsapp');
      await notifyMaddy(
        'Program safety flag',
        `Client ${client_id} week ${week_no}: ${safetyCheck.reason}`
      );
      return res.status(200).json({
        success: false,
        flagged: true,
        reason: safetyCheck.reason
      });
    }

    const { data: program, error: insertError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.notes,
        pdf_url: null
      })
      .select()
      .single();

    if (insertError) {
      console.error('Program insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const summary = programData.notes || `Week ${week_no} plan ready!`;
    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Week ${week_no}`,
        summary.slice(0, 200)
      ]
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function validateProgram(data) {
  if (!data || !data.nutrition_plan) {
    return { safe: false, reason: 'Missing nutrition plan' };
  }

  const cals = data.nutrition_plan.calories;
  if (cals && cals < 1200) {
    return { safe: false, reason: `Calories too low: ${cals}` };
  }

  const supps = (data.nutrition_plan.supplements || []).join(' ').toLowerCase();
  const banned = ['steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra', 'hgh'];
  for (const b of banned) {
    if (supps.includes(b)) {
      return { safe: false, reason: `Banned substance detected: ${b}` };
    }
  }

  return { safe: true };
}
