const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendText, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, corsHeaders } = require('./_lib/helpers');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'sarms', 'steroids',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'client not found' });
  }

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: existingProgram } = await db
    .from('programs')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .single();

  if (existingProgram) {
    return res.status(409).json({ error: 'program already generated for this week' });
  }

  const anthropic = new Anthropic();

  const systemPrompt = `You are Maddy's AI program architect for FitnessByMaddy. You create weekly personalized workout and nutrition plans.

RULES:
- Plans must be safe, evidence-based, and achievable
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines (e.g., "lose 10kg in a week")
- Account for injuries, medical conditions, and dietary preferences
- Progressive overload: each week should build on the last
- Include warm-up and cool-down in every workout

OUTPUT FORMAT: Return valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_note": "One short motivational/instructional note for the client"
}`;

  const clientProfile = {
    name: client.name,
    age: client.age,
    goal: client.goal,
    injuries: client.injuries,
    diet_pref: client.diet_pref,
    schedule: client.schedule,
    program: client.program,
    week: week_no
  };

  const checkinSummary = (recentCheckins || []).map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues
  }));

  const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${checkinSummary.length > 0 ? JSON.stringify(checkinSummary, null, 2) : 'No previous check-ins (first week)'}

Create a progressive, personalized plan. If there are injuries, work around them. If compliance was low, simplify. If energy was low, reduce volume slightly. Return ONLY the JSON object.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await notifyMaddy('Program generation failed', `Client: ${maskPhone(client.phone)}, Week ${week_no} — could not parse JSON`);
      return res.status(500).json({ error: 'failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
    if (flagged) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nPlease review before sending.`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: `FLAGGED: ${programData.weekly_note || ''}. Awaiting Maddy review.`
      });
      return res.status(200).json({ ok: true, flagged: true });
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_note
    }).select().single();

    const weekNote = programData.weekly_note || `Week ${week_no} program is ready!`;
    await sendText(client.phone, `Hey ${client.name || 'there'}! Your Week ${week_no} program is ready.\n\n${weekNote}\n\nCheck your dashboard or reply here if you have questions.`);

    if (program) {
      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    return res.status(200).json({ ok: true, program_id: program?.id });
  } catch (err) {
    console.error(`[GenProgram] Error for ${maskPhone(client.phone)}:`, err.message);
    await notifyMaddy('Program generation error', `Client: ${maskPhone(client.phone)}, Week ${week_no}\nError: ${err.message.slice(0, 200)}`);
    return res.status(500).json({ error: 'generation failed' });
  }
};
