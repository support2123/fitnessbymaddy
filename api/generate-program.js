const Anthropic = require('anthropic');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/helpers');

const SAFETY_FLAGS = [
  'below 1000 calories', 'below 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .or(`lead_id.eq.${client.lead_id},phone.eq.${client.phone}`)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      age: intake?.age,
      gender: intake?.gender,
      goal: intake?.goal,
      injuries: intake?.injuries,
      medical: intake?.medical_conditions,
      diet: intake?.diet_preference,
      experience: intake?.training_experience,
      equipment: intake?.available_equipment,
      schedule_days: intake?.schedule_days
    };

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const anthropic = new Anthropic();

    const systemPrompt = `You are Maddy's AI program architect for FitnessByMaddy.
You create weekly personalised workout and nutrition plans.

RULES:
- Never suggest anything below 1200 calories for women or 1500 for men
- Never suggest banned substances, steroids, or dangerous supplements
- Never promise specific weight loss timelines (e.g. "lose 10kg in 2 weeks")
- Always include rest days (minimum 1-2 per week)
- Scale difficulty based on experience level and check-in feedback
- If client reports pain or injury, reduce intensity and flag for review
- Format output as valid JSON with workout_plan and nutrition_plan keys`;

    const userPrompt = `Generate Week ${week_no} program for this client.

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

Return ONLY valid JSON:
{
  "workout_plan": {
    "overview": "brief week overview",
    "days": [
      {
        "day": 1,
        "name": "Day name",
        "focus": "muscle group",
        "exercises": [
          { "name": "exercise", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
        ]
      }
    ],
    "rest_days": [5, 7],
    "notes": "any special notes"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_timing": ["meal descriptions"],
    "hydration": "water recommendation",
    "supplements": ["safe supplements only"],
    "notes": "any dietary notes"
  },
  "coach_note": "1-liner personal note to the client"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData).toLowerCase();
    const hasSafetyIssue = SAFETY_FLAGS.some(flag => fullText.includes(flag));

    if (hasSafetyIssue) {
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy({
        reason: 'Safety flag in generated program',
        phone: client.phone,
        clientName: client.name,
        details: `Week ${week_no} program flagged for review`
      });
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        message: 'Program flagged for manual review'
      });
    }

    const { data: program, error } = await db
      .from('programs')
      .upsert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note || null
      }, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const market = detectMarket(client.phone);
    const isHinglish = market === 'IN';
    const coachNote = programData.coach_note || 'Keep pushing!';

    const msg = isHinglish
      ? `Week ${week_no} ka plan ready hai! ${coachNote}`
      : `Your Week ${week_no} plan is ready! ${coachNote}`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: msg,
      params: [client.name || 'Champion', String(week_no)]
    });

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
