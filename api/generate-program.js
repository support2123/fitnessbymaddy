const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { buildProgramPdf, uploadPdf, formatProgram } = require('../lib/pdf');
const { sendDocument } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*cal/i, /extreme\s*(fast|diet|cut)/i,
  /clenbuterol/i, /dnp/i, /eph?edrine/i, /anabolic/i, /steroid/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i,
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

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .maybeSingle();

    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .maybeSingle();
      try { intakeData = JSON.parse(lead?.first_msg || '{}'); } catch { intakeData = {}; }
    }

    const prompt = buildPrompt(client, intakeData, recentCheckins || [], prevProgram, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program from Claude response' });
    }

    let programData;
    try {
      programData = JSON.parse(jsonMatch[1]);
    } catch {
      return res.status(500).json({ error: 'Invalid JSON in Claude response' });
    }

    const raw = JSON.stringify(programData);
    if (UNSAFE_PATTERNS.some((p) => p.test(raw))) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy('Unsafe program content flagged by safety check', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program contained risky content. Auto-send halted.`,
      });

      await supabase.from('programs').insert({
        client_id, week_no,
        workout_plan: programData.workout_plan || null,
        nutrition_plan: programData.nutrition_plan || null,
        notes: '⚠️ FLAGGED FOR REVIEW — not auto-sent',
      });

      return res.status(200).json({ status: 'flagged_for_review' });
    }

    const pdfBuffer = await buildProgramPdf(
      client, week_no,
      programData.workout_plan,
      programData.nutrition_plan,
      programData.notes
    );

    const pdfUrl = await uploadPdf(client_id, week_no, pdfBuffer);

    const { error: progErr } = await supabase.from('programs').insert({
      client_id, week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || null,
      pdf_url: pdfUrl,
    });

    if (progErr) {
      console.error(`Program insert failed for ${maskPhone(client.phone)}:`, progErr.message);
    }

    const caption = programData.notes
      ? `Week ${week_no} — ${programData.notes.slice(0, 100)}`
      : `Your Week ${week_no} program is ready! 💪`;

    const sendResult = await sendDocument(client.phone, pdfUrl, caption);

    if (sendResult.ok) {
      await supabase.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({
      success: true,
      pdf_url: pdfUrl,
      sent: sendResult.ok,
    });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

function buildPrompt(client, intake, checkins, prevProgram, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a NASM-certified fitness coach named Maddy, creating a personalised weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${formatProgram(client.program)}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
${intake.age ? `- Age: ${intake.age}` : ''}
${intake.gender ? `- Gender: ${intake.gender}` : ''}
${intake.goal ? `- Goal: ${intake.goal}` : ''}
${intake.injuries ? `- Injuries/Limitations: ${intake.injuries}` : ''}
${intake.diet_preference ? `- Diet Preference: ${intake.diet_preference}` : ''}
${intake.experience_level ? `- Experience: ${intake.experience_level}` : ''}
${intake.schedule ? `- Schedule: ${intake.schedule}` : ''}
${intake.medical_conditions ? `- Medical: ${intake.medical_conditions}` : ''}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None reported'}` : 'No check-in data available yet.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg, Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10, Energy: ${prevCheckin.energy || 'N/A'}/10` : ''}

${prevProgram ? `LAST WEEK'S PROGRAM OVERVIEW:
${JSON.stringify(prevProgram, null, 2).slice(0, 1000)}` : ''}

RULES:
- Create a safe, science-backed program
- Never prescribe below 1200 kcal for women or 1500 kcal for men
- Never recommend supplements that aren't well-established (whey, creatine, vitamins are ok)
- If client reported pain/injury, adjust exercises to avoid aggravation
- Progressive overload from previous week when appropriate
- Be warm and encouraging in the notes

Return ONLY valid JSON in this exact format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 — Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "macros": { "protein": 150, "carbs": 200, "fat": 65 },
    "meals": [
      { "name": "Breakfast", "description": "..." },
      { "name": "Lunch", "description": "..." },
      { "name": "Dinner", "description": "..." },
      { "name": "Snacks", "description": "..." }
    ]
  },
  "notes": "One-liner context for the client about this week's focus"
}
\`\`\``;
}
