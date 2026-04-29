const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { generateProgramPDF } = require('../lib/pdf');
const { escalateToMaddy } = require('../lib/escalation');
const { sendJson, sendError, corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendError(res, 405, 'POST only');

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return sendError(res, 401, 'Unauthorized');
  }

  const { client_id, week_no } = req.body || {};
  if (!client_id || !week_no) {
    return sendError(res, 400, 'Missing client_id or week_no');
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return sendError(res, 404, 'Client not found');

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: lastProgram } = await db
    .from('programs')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(1)
    .single();

  const { data: intakeLead } = await db
    .from('leads')
    .select('first_msg')
    .eq('id', client.lead_id)
    .single();

  let intakeData = null;
  if (intakeLead?.first_msg) {
    try { intakeData = JSON.parse(intakeLead.first_msg); } catch {}
  }

  const systemPrompt = `You are a certified personal trainer and nutrition coach creating a weekly training and nutrition program. You work for Fitness by Maddy, a premium online coaching brand.

RULES:
- Programs must be safe, evidence-based, and progressive
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without medical backing
- Never promise unrealistic timelines
- Consider the client's injuries, medical conditions, and preferences
- Adjust based on check-in compliance and energy levels

OUTPUT FORMAT: Return valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "focus": "Chest, Shoulders, Triceps",
        "exercises": [
          {"name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s", "notes": ""}
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": {"protein": 180, "carbs": 220, "fat": 70},
    "meals": [
      {"name": "Meal 1 - Breakfast", "items": ["4 egg whites + 1 whole egg", "1 cup oats"], "notes": ""}
    ],
    "notes": "Hydration: 3-4L water daily"
  },
  "coach_notes": "Brief 1-2 sentence note for the client",
  "safety_flag": false
}

Set safety_flag to true if anything in the client data suggests a health risk that needs human review.`;

  const clientContext = `CLIENT PROFILE:
- Name: ${client.name || 'Unknown'}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
${intakeData ? `- Age: ${intakeData.age || 'N/A'}
- Gender: ${intakeData.gender || 'N/A'}
- Height: ${intakeData.height || 'N/A'}
- Current Weight: ${intakeData.weight || 'N/A'}
- Goal: ${intakeData.goal || 'N/A'}
- Injuries: ${intakeData.injuries || 'None'}
- Medical: ${intakeData.medical_conditions || 'None'}
- Diet: ${intakeData.diet_preference || 'No preference'}
- Equipment: ${intakeData.equipment_access || 'Full gym'}
- Experience: ${intakeData.experience_level || 'Intermediate'}` : ''}

${recentCheckins?.length ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No check-in data yet (first week).'}

${lastProgram ? `LAST WEEK'S PROGRAM SUMMARY:
Workout: ${JSON.stringify(lastProgram.workout_plan?.days?.map(d => d.name) || [])}
Calories: ${lastProgram.nutrition_plan?.calories || 'N/A'}` : ''}

Generate the Week ${week_no} program. Progress from last week where applicable.`;

  let programData;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: clientContext }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return sendError(res, 500, 'Program generation failed');
  }

  if (programData.safety_flag) {
    await escalateToMaddy(
      client.phone,
      'medical',
      `Week ${week_no} program flagged for safety review: ${programData.coach_notes || ''}`
    );
    return sendJson(res, 200, { flagged: true, reason: 'safety_review' });
  }

  let pdfUrl = null;
  try {
    const pdfBuffer = await generateProgramPDF(
      client, week_no,
      programData.workout_plan,
      programData.nutrition_plan,
      programData.coach_notes
    );

    const filePath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage.from('programs').upload(
      filePath, pdfBuffer,
      { contentType: 'application/pdf', upsert: true }
    );

    if (!uploadErr) {
      const { data: urlData } = db.storage.from('programs').getPublicUrl(filePath);
      pdfUrl = urlData?.publicUrl || null;
    }
  } catch (err) {
    console.error('PDF generation/upload error:', err.message);
  }

  const { data: program } = await db.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.coach_notes,
  }).select().single();

  if (pdfUrl) {
    const contextNote = programData.coach_notes || `Week ${week_no} program ready!`;
    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'Champion',
      String(week_no),
      contextNote,
    ], pdfUrl);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);
  }

  return sendJson(res, 200, {
    success: true,
    program_id: program.id,
    pdf_url: pdfUrl,
  });
};
