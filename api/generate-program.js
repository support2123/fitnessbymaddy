const { supabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let parsed;

    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      console.error('Failed to parse Claude response for', maskPhone(client.phone));
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    if (hasSafetyIssues(parsed)) {
      const { sendTemplate: notify } = require('./lib/whatsapp');
      await notify('+917082478374', 'escalation_alert', [
        'Risky program content detected',
        maskPhone(client.phone),
        `Week ${week_no} - needs manual review`
      ]);
      return res.status(200).json({ status: 'flagged_for_review' });
    }

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || parsed.workouts || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || null,
      pdf_url: null
    });

    if (insertError) throw insertError;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.notes || 'New program ready!'
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified fitness program architect for FitnessByMaddy.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Started: ${client.program_started_at}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No check-in data yet.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

${prevProgram ? `PREVIOUS PROGRAM NOTES: ${prevProgram.notes || 'None'}` : ''}

Generate a JSON program for Week ${weekNo}. Include:
1. workout_plan: 5-6 days of training (exercise, sets, reps, rest, notes)
2. nutrition_plan: daily calories, protein target, meal timing, sample meals
3. notes: 1-2 sentence context for the client

Rules:
- Progressive overload from previous week if available
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- Adjust based on compliance and energy scores
- If energy is low (<=4), reduce volume by 20%
- If compliance is low (<=5), simplify the plan

Return ONLY valid JSON wrapped in \`\`\`json code block.`;
}

function hasSafetyIssues(program) {
  const json = JSON.stringify(program).toLowerCase();
  const redFlags = [
    'dnp', 'clenbuterol', 'ephedrine', 'anabolic',
    'steroid', '800 cal', '900 cal', '1000 cal',
    'extreme cut', 'water fast', 'zero carb for'
  ];
  return redFlags.some(flag => json.includes(flag));
}
