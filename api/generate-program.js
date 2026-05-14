const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { generateProgramPDF, uploadPDF, formatProgramName } = require('../lib/pdf');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const prevPlan = prevPrograms && prevPrograms[0] ? prevPrograms[0] : null;

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy. You create personalized weekly workout and nutrition plans.

RULES:
- Plans must be safe, evidence-based, and appropriate for the client's level
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 kcal for men)
- Never recommend banned or dangerous substances
- Never promise unrealistic timelines
- Provide progressive overload each week
- Output ONLY valid JSON with no markdown formatting

Output format:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 65 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "4 egg whites + 1 whole egg, oats with banana" }
    ]
  },
  "notes": "Focus on progressive overload this week. Increase weight by 2.5kg on compound lifts."
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Unknown'}
Program: ${formatProgramName(client.program)}
Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}

Recent check-in data:
${checkinSummary.length > 0 ? JSON.stringify(checkinSummary, null, 2) : 'No check-ins yet (Week 1)'}

${prevPlan ? `Previous week plan summary:
Workout focus: ${prevPlan.notes || 'N/A'}` : 'This is the first week.'}

Design an appropriate Week ${week_no} plan with progressive adjustments based on the data above.`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    if (hasSafetyIssue(rawText)) {
      await escalateToMaddy(
        'Safety flag in generated program',
        `Client: ${client.name} (Week ${week_no})\nFlagged content detected — review before sending.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged', needs_review: true });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse Claude response as JSON');
      }
    }

    const workout = parsed.workout || {};
    const nutrition = parsed.nutrition || {};
    const notes = parsed.notes || '';

    const pdfBuffer = await generateProgramPDF(client, week_no, workout, nutrition, notes);
    const pdfUrl = await uploadPDF(client.id, week_no, pdfBuffer);

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workout,
      nutrition_plan: nutrition,
      notes
    }).select().single();

    if (error) throw error;

    const { data: lead } = await supabase
      .from('leads')
      .select('market')
      .eq('id', client.lead_id)
      .single();

    const hinglish = lead ? isHinglish(lead.market) : false;
    const templateName = hinglish ? 'weekly_program_hi' : 'weekly_program';

    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      week_no.toString(),
      notes.slice(0, 100)
    ], true);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
