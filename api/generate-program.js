const { getSupabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy } = require('./lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('./lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedrine', 'sarm',
  'steroid', 'testosterone', 'trenbolone',
  'lose 10 kg in 1 week', 'lose 20 pounds in a week',
  'water fast', 'zero calorie'
];

function checkSafety(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const sb = getSupabase();

    const { data: client } = await sb.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await sb
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const systemPrompt = `You are the program architect for FitnessByMaddy, a premium online coaching brand.
Generate a week ${week_no} training and nutrition program for a client.

RULES:
- Be evidence-based and conservative. No extreme deficits (<1200 cal for women, <1500 for men).
- No banned substances. No unrealistic timelines.
- Progressive overload principles. Adjust based on check-in data.
- Output valid JSON with keys: workout_plan, nutrition_plan, notes.
- workout_plan: array of day objects {day, focus, exercises: [{name, sets, reps, rest, notes}]}
- nutrition_plan: {daily_calories, protein_g, carbs_g, fat_g, meal_framework: [{meal, description}], hydration, supplements:[]}
- notes: string with 2-3 sentences of coaching context for this week.`;

    const userPrompt = `CLIENT PROFILE:
Name: ${client.name || 'Client'}
Program: ${client.program}
Week: ${week_no} of 12
Started: ${client.program_started_at}

${intake ? `INTAKE DATA:
Age: ${intake.age || 'N/A'}
Gender: ${intake.gender || 'N/A'}
Goal: ${intake.goal || 'N/A'}
Injuries: ${intake.injuries || 'None'}
Diet preference: ${intake.diet_pref || 'No preference'}
Schedule: ${intake.schedule || 'Flexible'}
Medical: ${intake.medical_conditions || 'None'}
Activity level: ${intake.current_activity || 'N/A'}` : 'No intake data available.'}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No check-in data yet (first week).'}

Generate the Week ${week_no} program. Return ONLY valid JSON.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude did not return valid JSON');
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData);
    const safetyIssue = checkSafety(fullText);

    if (safetyIssue) {
      await sb.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || null,
        nutrition_plan: programData.nutrition_plan || null,
        notes: programData.notes || null,
        flagged: true,
        flag_reason: `Safety flag: ${safetyIssue}`
      });

      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${maskPhone(client.phone)} (Week ${week_no})\nFlag: ${safetyIssue}\nPlease review before sending.`
      );

      return res.status(200).json({ success: true, flagged: true, reason: safetyIssue });
    }

    const { data: program } = await sb.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan || null,
      nutrition_plan: programData.nutrition_plan || null,
      notes: programData.notes || null,
      flagged: false
    }).select().single();

    const market = detectMarket(client.phone);
    const templateName = isHinglish(market) ? 'weekly_program_hi' : 'weekly_program';
    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      String(week_no),
      programData.notes || 'Your new program is ready!'
    ]);

    await sb.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
