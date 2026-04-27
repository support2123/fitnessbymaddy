const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { json, maskPhone, programLabel } = require('../lib/utils');

const SAFETY_FLAGS = [
  'less than 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroids', 'sarms',
  'lose 10kg in 1 week', 'lose 20 pounds in 2 weeks',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) return json(res, { error: 'Missing fields' }, 400);

    // Get client data
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return json(res, { error: 'Client not found' }, 404);

    // Get last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get previous program for continuity
    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    // Build Claude prompt
    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create science-backed, personalised weekly programs.

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, supplements without evidence, or unrealistic timelines
- Always include progressive overload principles
- Consider injury history and medical conditions
- Be warm, expert, and encouraging — never bro-sciency
- Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan"

workout_plan structure: { "days": [{ "day": "Monday", "focus": "Upper Body Push", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }], "cardio": "..." }], "notes": "..." }

nutrition_plan structure: { "calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 70, "meals": [{ "meal": "Breakfast", "options": ["..."] }], "hydration": "...", "supplements": ["..."], "notes": "..." }`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${programLabel(client.program)}
- Started: ${client.program_started_at}
- Intake data: ${JSON.stringify(client.intake_data || {})}

RECENT CHECK-INS:
${checkins && checkins.length > 0
  ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : 'No check-ins yet (Week 1)'}

PREVIOUS WEEK PROGRAM:
${prevProgram ? JSON.stringify(prevProgram.workout_plan) : 'None (first week)'}

Generate a progressive, personalised Week ${week_no} program. Adjust based on compliance, energy levels, and any reported issues. Output ONLY the JSON.`;

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    // Parse JSON from response
    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      await notifyMaddy(`Program generation parse error for ${maskPhone(client.phone)} week ${week_no}`);
      return json(res, { error: 'Failed to parse program' }, 500);
    }

    // Safety check
    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));

    // Store in database
    const { data: program, error: progErr } = await db.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.workout_plan?.notes || null,
      flagged_for_review: flagged,
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (progErr) {
      console.error('Program save error:', progErr.message);
      return json(res, { error: 'Failed to save program' }, 500);
    }

    if (flagged) {
      await notifyMaddy(
        `Program FLAGGED for review — ${client.name || maskPhone(client.phone)} Week ${week_no}. Check admin dashboard.`
      );
      return json(res, { ok: true, flagged: true, id: program.id });
    }

    // Send via WhatsApp
    const weekSummary = buildWeekSummary(programData, week_no);
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [client.name || 'there', String(week_no), weekSummary],
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return json(res, { ok: true, id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};

function buildWeekSummary(data, weekNo) {
  const workout = data.workout_plan;
  const nutrition = data.nutrition_plan;
  const days = workout?.days?.length || 0;
  const cal = nutrition?.calories || '~';
  const protein = nutrition?.protein_g || '~';
  return `Week ${weekNo}: ${days} training days, ${cal} kcal target, ${protein}g protein. ${workout?.notes || 'Stay consistent!'}`;
}
