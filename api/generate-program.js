const { supabase } = require('../lib/supabase');
const { generateProgramPDF, uploadPDF, formatProgram } = require('../lib/pdf');
const { sendWhatsApp } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'under 1000', 'below 1000',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in a week', 'crash diet',
  'starvation'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Get client profile
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get lead data for intake info
    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      if (lead && lead.first_msg) {
        try { intakeData = JSON.parse(lead.first_msg); } catch (e) {}
      }
    }

    // Build prompt
    const prompt = buildProgramPrompt(client, checkins || [], intakeData, week_no);

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: `You are a certified fitness program architect working for FitnessByMaddy.
You create weekly workout and nutrition plans that are safe, effective, and personalized.
NEVER recommend extreme calorie deficits (below 1200 for women, 1500 for men).
NEVER recommend banned substances, steroids, SARMs, or unsafe supplements.
NEVER promise unrealistic timelines (e.g., "lose 10kg in 1 week").
Always output valid JSON with the exact schema requested.`,
      messages: [{ role: 'user', content: prompt }]
    });

    const aiText = response.content[0].text;

    // Parse JSON from response
    let parsed;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const workoutPlan = parsed.workout_plan || parsed.workoutPlan || {};
    const nutritionPlan = parsed.nutrition_plan || parsed.nutritionPlan || {};
    const notes = parsed.notes || parsed.coach_notes || '';

    // Safety check
    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));

    if (flagged) {
      const { notifyMaddy } = require('../lib/escalation');
      await notifyMaddy('Program safety flag — review before sending', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program flagged for safety review`
      });
      return res.status(200).json({ ok: true, status: 'flagged_for_review', week_no });
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    // Store in programs table (audit trail — REQUIRED before sending)
    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }).select().single();

    // Send via WhatsApp
    const contextNote = notes
      ? notes.slice(0, 150)
      : `Week ${week_no} program is ready! Check the PDF for your full plan.`;

    await sendWhatsApp(
      client.phone,
      `Hey ${client.name || 'there'}! Your Week ${week_no} program is ready.\n\n${contextNote}\n\nPDF: ${pdfUrl}`
    );

    // Update whatsapp_sent_at
    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, intakeData, weekNo) {
  const programName = formatProgram(client.program);
  let prompt = `Create a Week ${weekNo} program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'N/A'}
- Program: ${programName}
- Started: ${client.program_started_at || 'N/A'}`;

  if (intakeData.goal) prompt += `\n- Goal: ${intakeData.goal}`;
  if (intakeData.experience_level) prompt += `\n- Experience: ${intakeData.experience_level}`;
  if (intakeData.injuries) prompt += `\n- Injuries/Limitations: ${intakeData.injuries}`;
  if (intakeData.diet_preference) prompt += `\n- Diet Preference: ${intakeData.diet_preference}`;
  if (intakeData.schedule) prompt += `\n- Schedule: ${intakeData.schedule}`;
  if (intakeData.current_weight) prompt += `\n- Current Weight: ${intakeData.current_weight}`;
  if (intakeData.target_weight) prompt += `\n- Target Weight: ${intakeData.target_weight}`;
  if (intakeData.gender) prompt += `\n- Gender: ${intakeData.gender}`;
  if (intakeData.age) prompt += `\n- Age: ${intakeData.age}`;

  if (checkins.length > 0) {
    prompt += '\n\nRECENT CHECK-INS:';
    checkins.forEach(c => {
      prompt += `\n- Week ${c.week_no}: Weight=${c.weight || 'N/A'}, Waist=${c.waist || 'N/A'}, Compliance=${c.compliance_score || 'N/A'}/10, Energy=${c.energy || 'N/A'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      if (c.next_week_focus) prompt += `, Focus: ${c.next_week_focus}`;
    });
  }

  prompt += `

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "name": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fats": 65 },
    "meals": [
      { "name": "Breakfast", "time": "8:00 AM", "description": "..." }
    ]
  },
  "notes": "Brief coach note for the client about this week's focus."
}

Return ONLY the JSON object, no markdown or extra text.`;

  return prompt;
}
