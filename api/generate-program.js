const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'less than 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'water fasting for', 'zero carb for weeks'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

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
      .maybeSingle();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Always provide safe, evidence-based recommendations
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Set realistic expectations (0.5-1kg fat loss per week max)
- Consider injuries, medical conditions, and client feedback
- Output MUST be valid JSON with "workout_plan" and "nutrition_plan" keys
- Workout plan: array of daily sessions with exercises, sets, reps, rest
- Nutrition plan: daily calorie target, macros, meal suggestions`;

    const userPrompt = buildPrompt(client, recentCheckins || [], lastProgram, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = message.content[0].text;

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse program JSON');
      return res.status(500).json({ error: 'Program generation failed — invalid JSON' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => fullText.includes(f));

    if (flagged) {
      await escalateToMaddy(
        'Program safety flag',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nFlagged content detected — manual review required.`
      );
      return res.status(200).json({ ok: true, action: 'flagged_for_review' });
    }

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: parsed.workout_plan || parsed.workoutPlan || {},
        nutrition_plan: parsed.nutrition_plan || parsed.nutritionPlan || {},
        notes: parsed.notes || null
      })
      .select('id')
      .single();

    const contextNote = buildContextNote(parsed, week_no);
    await sendWhatsApp(
      client.phone,
      [client.name || 'there', String(week_no), contextNote],
      'weekly_program'
    );

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({
      ok: true,
      programId: program.id,
      weekNo: week_no
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, lastProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Unknown'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Started: ${client.program_started_at}\n\n`;

  if (checkins.length > 0) {
    prompt += `Recent check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, `;
      prompt += `Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += `\n`;
    }
    prompt += '\n';
  }

  if (lastProgram) {
    prompt += `Last week's program summary available — adjust based on check-in feedback.\n\n`;
  }

  prompt += `Return a JSON object with:\n`;
  prompt += `- "workout_plan": array of 5-6 daily sessions, each with "day", "focus", "exercises" (array of {name, sets, reps, rest, notes})\n`;
  prompt += `- "nutrition_plan": {calories, protein_g, carbs_g, fat_g, meals: [{meal, items, notes}]}\n`;
  prompt += `- "notes": string with a brief weekly focus note for the client\n`;

  return prompt;
}

function buildContextNote(parsed, weekNo) {
  const notes = parsed.notes || '';
  if (notes) return notes.slice(0, 200);
  return `Week ${weekNo} program is ready! Check your plan and let us know if you have questions.`;
}
