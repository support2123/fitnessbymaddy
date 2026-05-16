const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'below 1000 calories', 'below 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 5kg in 3 days'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildProgramPrompt(client, recentCheckins || [], prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let programData;

    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));

    if (flagged) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy('Program safety flag', {
        clientName: client.name,
        phone: client.phone,
        details: `Week ${week_no} program flagged for safety review`
      });
      return res.status(200).json({ status: 'flagged_for_review', week_no });
    }

    const pdfUrl = `${client.folder_url}/week_${week_no}.json`;

    await supabase.storage
      .from('programs')
      .upload(`${client_id}/week_${week_no}.json`, JSON.stringify(programData, null, 2), {
        contentType: 'application/json',
        upsert: true
      });

    await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || programData.workouts,
      nutrition_plan: programData.nutrition_plan || programData.nutrition,
      notes: programData.coach_notes || programData.notes || null
    });

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.coach_notes || 'New program ready! Check your plan and let\'s crush it this week.'
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no, client_id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildProgramPrompt(client, checkins, prevProgram, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified personal trainer and nutrition coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? '12' : '6'}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None reported'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm` : ''}

${prevProgram ? `PREVIOUS PROGRAM NOTES: ${prevProgram.notes || 'None'}` : ''}

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }] },
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": ["..."],
    "hydration": "...",
    "supplements": ["..."]
  },
  "coach_notes": "Brief motivational + technical note for the client (2-3 sentences, warm tone)"
}

RULES:
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Adjust volume/intensity based on compliance and energy scores
- If compliance is low, simplify the plan
- If energy is low, reduce volume and add recovery work
- Progressive overload: slightly increase demand from previous week`;
}
