const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { createProgramPDF, uploadPDF, formatProgramName } = require('../lib/pdf-generator');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'below 800 calories', 'starvation',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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

    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      try {
        intakeData = JSON.parse(lead?.first_msg || '{}');
      } catch { /* not JSON intake data */ }
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect working for Fitness by Maddy,
an elite online coaching brand. Create science-backed, safe, progressive training and nutrition plans.

RULES:
- Never recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances, SARMs, or steroids
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Always include warm-up and cool-down
- Account for injuries and medical conditions
- Progressive overload each week
- Output ONLY valid JSON with no markdown wrapping`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${formatProgramName(client.program)}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}

INTAKE DATA:
${JSON.stringify(intakeData, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(recentCheckins || [], null, 2)}

PREVIOUS WEEK PROGRAM:
${JSON.stringify(prevProgram || 'First week - no previous program', null, 2)}

Return JSON in this exact format:
{
  "workout_plan": [
    {
      "day": "Day 1 - Upper Body",
      "exercises": [
        {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s"},
        ...
      ]
    },
    ...
  ],
  "nutrition_plan": [
    {
      "title": "Daily Targets",
      "items": ["Calories: 2000", "Protein: 150g", "Carbs: 200g", "Fats: 70g"]
    },
    {
      "day": "Sample Meal Plan",
      "meals": ["Meal 1: ...", "Meal 2: ...", ...]
    }
  ],
  "notes": "Brief coach note about focus for this week"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    const safetyViolation = SAFETY_FLAGS.some(flag =>
      rawText.toLowerCase().includes(flag)
    );
    if (safetyViolation) {
      await escalateToMaddy(
        'Safety flag in generated program',
        client.phone,
        `Week ${week_no} program flagged for review`
      );
      return res.json({ ok: false, reason: 'safety_review_required' });
    }

    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      console.error('[GENERATE] Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const { workout_plan, nutrition_plan, notes } = programData;

    const pdfBuffer = await createProgramPDF(
      client, week_no, workout_plan, nutrition_plan, notes
    );
    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan,
      nutrition_plan,
      notes,
    });

    const market = client.market || 'GLOBAL';
    const hinglish = isHinglish(market);
    const templateName = hinglish ? 'weekly_program_hi' : 'weekly_program_en';

    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      `${week_no}`,
      notes || 'New program ready!',
    ], true);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ ok: true, pdfUrl, weekNo: week_no });
  } catch (err) {
    console.error('[GENERATE-PROGRAM ERROR]', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
