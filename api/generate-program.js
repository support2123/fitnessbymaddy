const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();

    const systemPrompt = `You are an elite fitness program architect for FitnessByMaddy.
Design weekly training and nutrition programs that are:
- Evidence-based and safe
- Progressive (build on previous weeks)
- Personalized to the client's profile and check-in data
- Never include extreme calorie cuts (<1200kcal for women, <1500 for men)
- Never recommend banned substances or supplements without strong evidence
- Always include rest days and deload guidance

Output ONLY valid JSON with this structure:
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
    "fats_g": 65,
    "meal_timing": "...",
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "Brief coaching note for the week"
}`;

    const userPrompt = buildClientContext(client, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;
    let programData;

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      await notifyMaddy('Program generation parse error', `Client: ${client_id}, Week: ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    if (isSafeProgram(programData) === false) {
      await notifyMaddy('Unsafe program flagged', `Client: ${client_id}, Week: ${week_no} - Review needed`);
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
    }).select().single();

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [
        client.name || 'there',
        `Week ${week_no}`,
        programData.notes || 'New week, new gains!',
      ],
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildClientContext(client, checkins, weekNo) {
  let ctx = `CLIENT PROFILE:
- Name: ${client.name || 'Unknown'}
- Age: ${client.age || 'Not specified'}
- Program: ${client.program}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}
- Week Number: ${weekNo} of 12

`;

  if (checkins && checkins.length > 0) {
    ctx += 'RECENT CHECK-INS:\n';
    checkins.forEach(ci => {
      ctx += `- Week ${ci.week_no}: Weight ${ci.weight || '?'}kg, Waist ${ci.waist || '?'}cm, Compliance ${ci.compliance_score}/10, Energy ${ci.energy}/10`;
      if (ci.issues) ctx += `, Issues: ${ci.issues}`;
      ctx += '\n';
    });
  } else {
    ctx += 'No previous check-ins (first week).\n';
  }

  ctx += `\nGenerate the Week ${weekNo} program. Ensure progressive overload from previous weeks if data available.`;
  return ctx;
}

function isSafeProgram(program) {
  if (!program || !program.nutrition_plan) return false;

  const cals = program.nutrition_plan.calories;
  if (cals && cals < 1200) return false;

  const notes = (program.notes || '').toLowerCase();
  const banned = ['steroid', 'dnp', 'clenbuterol', 'ephedra', 'sarm'];
  if (banned.some(b => notes.includes(b))) return false;

  return true;
}
