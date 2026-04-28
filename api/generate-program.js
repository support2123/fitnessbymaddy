const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF, uploadPDF } = require('../lib/pdf');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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

    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = {};
    if (intakeMsg?.body) {
      try {
        const jsonStr = intakeMsg.body.replace('Intake form: ', '');
        intakeData = JSON.parse(jsonStr);
      } catch (_) {}
    }

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const prompt = `You are a certified fitness coach (NASM CPT & Nutrition Coach) creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
- Goal: ${intakeData.goal || 'general fitness'}
- Injuries/limitations: ${intakeData.injuries || 'none reported'}
- Diet preference: ${intakeData.diet_pref || 'no restrictions'}
- Schedule availability: ${intakeData.schedule || 'flexible'}
- Age: ${intakeData.age || 'not specified'}
- Gender: ${intakeData.gender || 'not specified'}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

Create a complete weekly program. Return ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "2 min rest" }
        ]
      }
    ]
  },
  "nutrition": {
    "daily_calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fat": 70,
    "meals": [
      { "meal": "Meal 1 - Breakfast", "foods": "4 eggs, 2 toast, 1 banana", "calories": 550 }
    ]
  },
  "coach_notes": "Brief note about this week's focus and adjustments."
}

Rules:
- Be realistic and safe. No extreme deficits below 1200 kcal.
- Adapt based on check-in data (adjust if compliance is low or energy is low).
- If injuries reported, modify exercises accordingly.
- Progressive overload week over week.
- Keep it practical for the client's lifestyle.`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawText = response.content[0].text;

    if (hasSafetyIssue(rawText)) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        'Safety flag in generated program',
        client.phone,
        `Week ${week_no}: AI output flagged for review`
      );
      return res.status(422).json({ error: 'Program flagged for safety review' });
    }

    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (_) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const pdfBuffer = await generateProgramPDF(
      client.name || 'Client',
      week_no,
      programData.workout,
      programData.nutrition,
      programData.coach_notes
    );

    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    const { error: dbErr } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.coach_notes
    });

    if (dbErr) throw dbErr;

    const { data: lead } = await db
      .from('leads')
      .select('market')
      .eq('id', client.lead_id)
      .single();

    const market = lead?.market || 'GLOBAL';
    const contextNote = isHinglish(market)
      ? [`Week ${week_no} ka program ready hai! ${programData.coach_notes || 'Check karo aur questions ho toh pooch lo.'}`]
      : [`Your Week ${week_no} program is ready! ${programData.coach_notes || 'Review it and reach out with any questions.'}`];

    await sendTemplate(client.phone, 'weekly_program', contextNote);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

    return res.json({
      success: true,
      pdf_url: pdfUrl,
      week_no
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
