const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { generateProgramPDF, formatProgram } = require('../lib/pdf');
const { sendTextMessage } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'lose 20', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Get client data
    const { data: client } = await supabase()
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get last 2 check-ins
    const { data: checkins } = await supabase()
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get intake form data from messages
    const { data: intakeMsgs } = await supabase()
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form_submission')
      .order('sent_at', { ascending: false })
      .limit(1);

    let intakeData = {};
    if (intakeMsgs && intakeMsgs.length > 0) {
      try { intakeData = JSON.parse(intakeMsgs[0].body); } catch {}
    }

    // Build Claude prompt
    const prompt = buildProgramPrompt(client, checkins || [], intakeData, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content[0].text;

    // Parse JSON from response
    let programData;
    try {
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) ||
                         responseText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch
        ? (jsonMatch[1] || jsonMatch[0])
        : responseText;
      programData = JSON.parse(jsonStr);
    } catch {
      console.error('Failed to parse program JSON');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    // Safety check
    const fullText = JSON.stringify(programData).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (fullText.includes(flag)) {
        await escalateToMaddy(
          client.phone,
          `Safety flag in generated program: "${flag}"`,
          `Week ${week_no} program flagged for review`,
          client_id
        );
        return res.status(200).json({
          ok: false,
          reason: 'flagged_for_review',
          flag
        });
      }
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(
      client,
      week_no,
      programData.workout_plan || programData.workout,
      programData.nutrition_plan || programData.nutrition,
      programData.notes || programData.coach_notes
    );

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase().storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr);
    }

    // Get signed URL
    const { data: urlData } = await supabase().storage
      .from('clients')
      .createSignedUrl(pdfPath, 60 * 60 * 24 * 7);

    const pdfUrl = urlData?.signedUrl || pdfPath;

    // Save to programs table
    const { data: program } = await supabase()
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan || programData.workout,
        nutrition_plan: programData.nutrition_plan || programData.nutrition,
        notes: programData.notes || programData.coach_notes
      })
      .select()
      .single();

    // Send via WhatsApp
    const contextNote = programData.context_note ||
      `Week ${week_no} program ready! Focus: ${programData.notes?.slice(0, 100) || 'progressive overload'}`;

    await sendTextMessage(client.phone, contextNote);

    // Update program with send timestamp
    await supabase()
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      ok: true,
      program_id: program.id,
      pdf_url: pdfUrl
    });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, intake, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified personal trainer and nutrition coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${formatProgram(client.program)}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Started: ${client.program_started_at}
${intake.goal ? `- Goal: ${intake.goal}` : ''}
${intake.experience ? `- Experience: ${intake.experience}` : ''}
${intake.injuries ? `- Injuries/Limitations: ${intake.injuries}` : ''}
${intake.diet_pref ? `- Diet Preference: ${intake.diet_pref}` : ''}
${intake.schedule ? `- Schedule: ${intake.schedule}` : ''}
${intake.current_weight ? `- Starting Weight: ${intake.current_weight}` : ''}
${intake.height ? `- Height: ${intake.height}` : ''}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}
${lastCheckin.next_week_focus ? `- Focus: ${lastCheckin.next_week_focus}` : ''}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}, Compliance: ${prevCheckin.compliance_score}/10` : ''}

Generate a complete weekly program. Return ONLY valid JSON in this exact format:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "focus": "Chest, shoulders, triceps",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 65 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["3 eggs scrambled", "2 toast", "1 banana"] }
    ]
  },
  "notes": "Brief coach note about this week's focus and adjustments.",
  "context_note": "One-liner WhatsApp message summarizing the week."
}

RULES:
- Never suggest extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or unsafe supplements
- Set realistic, achievable weekly targets
- Adjust based on compliance and energy scores from check-ins
- Include rest days (2 per week minimum)
- If the client reported issues, address them in the program`;
}
