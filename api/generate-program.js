const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendWhatsApp } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'ephedrine', 'diuretic for weight loss'
];

function hasSafetyIssues(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db.from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db.from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const { data: recentCheckins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db.from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      totalWeeks: client.program === '12wk' ? 12 : 6,
      age: intake?.age,
      gender: intake?.gender,
      height: intake?.height,
      currentWeight: recentCheckins?.[0]?.weight || intake?.weight,
      goal: intake?.goal,
      injuries: intake?.injuries,
      medicalConditions: intake?.medical_conditions,
      dietPreference: intake?.diet_preference,
      activityLevel: intake?.activity_level,
      schedule: intake?.schedule,
      equipment: intake?.equipment_access
    };

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const prompt = `You are a NASM-certified fitness program architect for Fitness by Maddy. Generate a complete weekly program.

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

PREVIOUS WEEK PLAN:
${JSON.stringify(prevPrograms?.[0] || 'First week - no previous plan', null, 2)}

RULES:
- Design a progressive, science-backed program appropriate for week ${week_no} of ${clientProfile.totalWeeks}
- Account for any injuries or medical conditions listed
- Respect diet preferences
- Include warm-up and cool-down guidance
- If compliance was low, simplify slightly and add motivation
- If energy was low, consider deload or recovery focus
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, steroids, or dangerous supplements
- Be specific with exercises: name, sets, reps, rest periods
- Include 5-6 training days with 1-2 rest days
- Provide complete nutrition with meals, macros, and calorie targets

Respond ONLY with valid JSON in this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1",
        "name": "Day Name",
        "focus": "Muscle Group",
        "exercises": [
          { "name": "Exercise", "sets": 4, "reps": "8-12", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "macros": { "protein": 150, "carbs": 200, "fat": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["item1", "item2"] }
    ],
    "notes": "Any dietary notes"
  },
  "coach_notes": "Personalized message for the client about this week's focus"
}`;

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssues(responseText)) {
      const { sendWhatsApp: alert } = require('../lib/whatsapp');
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        client.phone,
        client.name,
        'safety_flag',
        `Week ${week_no} program generation flagged for safety review`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: null,
        nutrition_plan: null,
        notes: 'FLAGGED FOR SAFETY REVIEW'
      });

      return res.status(200).json({ action: 'flagged_for_review' });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const { workout_plan, nutrition_plan, coach_notes } = parsed;

    const pdfBuffer = await generateProgramPDF(
      client.name,
      week_no,
      workout_plan,
      nutrition_plan,
      coach_notes
    );

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: pdfUrl } = db.storage.from('client-files').getPublicUrl(pdfPath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl?.publicUrl || pdfPath,
      workout_plan,
      nutrition_plan,
      notes: coach_notes
    }).select().single();

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name,
      templateParams: [client.name, String(week_no)]
    }, `Hey ${client.name}! 💪\n\nYour Week ${week_no} program is ready!\n\n${coach_notes || ''}\n\nPDF: ${pdfUrl?.publicUrl || 'Check your client portal'}`);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program?.id);

    return res.status(200).json({
      success: true,
      program_id: program?.id,
      pdf_url: pdfUrl?.publicUrl
    });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
