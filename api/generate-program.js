const { getSupabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get intake data from messages
    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = {};
    if (intakeMsg?.body) {
      try {
        const jsonStr = intakeMsg.body.replace('INTAKE FORM: ', '');
        intakeData = JSON.parse(jsonStr);
      } catch (_) {}
    }

    const anthropic = new Anthropic();

    const prompt = `You are a NASM-certified fitness program architect creating Week ${week_no} of a 12-week program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Goal: ${intakeData.goal || 'general fitness'}
- Experience: ${intakeData.experience_level || 'intermediate'}
- Diet preference: ${intakeData.diet_preference || 'flexible'}
- Injuries/conditions: ${intakeData.injuries || 'none reported'}
- Schedule: ${intakeData.schedule || '5 days/week'}

RECENT CHECK-INS:
${checkins?.length ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n') : 'No check-ins yet (Week 1)'}

INSTRUCTIONS:
1. Create a progressive workout plan for this week (${intakeData.schedule || '5 days'})
2. Create a nutrition plan with macro targets and meal suggestions
3. Include a 1-liner context note for the WhatsApp message
4. Be specific with exercises (sets x reps x tempo), rest periods
5. Adjust based on compliance, energy, and reported issues
6. NEVER recommend extreme calorie deficits (<1200 cal), banned substances, or unrealistic timelines

Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "cardio": "15min incline walk"
      }
    ],
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meals": [
      {"meal": "Breakfast", "suggestion": "4 eggs + 2 toast + avocado", "macros": "P30 C40 F20"}
    ],
    "hydration": "3-4L water",
    "supplements": ["whey protein", "creatine 5g"]
  },
  "whatsapp_note": "Week 2 focus: progressive overload on compound lifts. You crushed compliance last week!"
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    // Extract JSON from response
    let programData;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      programData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Failed to parse program JSON from Claude response');
    }

    // Safety check
    const fullText = JSON.stringify(programData);
    if (hasSafetyIssue(fullText)) {
      await escalateToMaddy(
        'Safety flag in generated program',
        `Client: ${client.name || client.phone}\nWeek: ${week_no}\nFlagged content detected in generated program. Please review before sending.`
      );
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        message: 'Program flagged for Maddy review'
      });
    }

    // Store in programs table
    const { data: program, error: progErr } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.whatsapp_note
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (progErr) {
      console.error('Program save error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    // Send WhatsApp with context note
    const waNote = programData.whatsapp_note || `Your Week ${week_no} program is ready!`;
    await sendText(client.phone, `${waNote}\n\nYour full workout & nutrition plan for this week has been generated. Check your program dashboard or ask me for details!`, true);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
