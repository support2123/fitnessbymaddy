const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'sarm', 'steroid',
  'lose 10kg in 1 week', 'drop 20 pounds in'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Get client profile
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get last 2 check-ins for context
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get previous program if exists
    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    // Build the prompt
    const clientContext = {
      name: client.name || 'Client',
      age: client.age,
      goal: client.goal,
      injuries: client.injuries,
      diet_pref: client.diet_pref,
      schedule: client.schedule,
      program: client.program,
      week: week_no
    };

    const checkinContext = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const systemPrompt = `You are an expert fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans based on client data.
Your programs must be:
- Safe and evidence-based (no extreme deficits, no banned substances)
- Progressive (build on previous weeks)
- Realistic for the client's schedule and fitness level
- Specific with sets, reps, rest times, and meal portions

Output valid JSON with exactly this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_focus": "...",
  "notes_for_client": "..."
}`;

    const userPrompt = `Create Week ${week_no} program for this client:

CLIENT PROFILE:
${JSON.stringify(clientContext, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(checkinContext, null, 2)}

PREVIOUS WEEK PROGRAM:
${prevProgram ? JSON.stringify({ workout: prevProgram.workout_plan, nutrition: prevProgram.nutrition_plan }, null, 2) : 'None (first week)'}

Design a progressive, personalized plan for this week. Adjust based on compliance, energy levels, and any reported issues.`;

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    // Safety check
    if (hasSafetyIssue(responseText)) {
      await escalateToMaddy('Safety flag in generated program', {
        phone: maskPhone(client.phone),
        details: `Week ${week_no} program flagged for review`
      });
      return res.status(200).json({ action: 'flagged_for_review', client_id, week_no });
    }

    // Parse JSON from response
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('[Generate] Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    // Store in programs table
    const { data: program, error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes_for_client || programData.weekly_focus,
      pdf_url: null
    }).select().single();

    if (progErr) {
      console.error('[Generate] Program insert error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    // Send WhatsApp notification to client
    await sendTemplate(client.phone, 'program_ready', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.weekly_focus || 'Check your new program!'
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no
    });

  } catch (err) {
    console.error('[Generate Program] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
