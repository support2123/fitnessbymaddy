const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { sendTextMessage, notifyMaddy } = require('./lib/whatsapp');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SYSTEM_PROMPT = `You are Maddy's AI program architect for FitnessByMaddy. You generate personalised weekly workout and nutrition plans.

Rules:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or unproven supplements
- Never promise unrealistic timelines ("lose 10kg in 1 week")
- Always account for injuries, medical conditions, and fitness level
- Progressive overload principle: increase volume/intensity by 5-10% weekly
- Include rest days and deload weeks where appropriate
- Nutrition should be practical and culturally relevant (Indian diet options for IN market)

Output format: Return valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}] }
    ],
    "rest_days": ["Sunday"],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meals": [
      { "time": "8:00 AM", "name": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "3L minimum",
    "notes": "..."
  },
  "weekly_focus": "...",
  "motivation_note": "..."
}`;

function validatePlan(plan) {
  const issues = [];
  if (plan.nutrition_plan) {
    const cal = plan.nutrition_plan.calories;
    if (cal && cal < 1200) issues.push(`Calories too low: ${cal}`);
  }
  if (plan.workout_plan && plan.workout_plan.days) {
    if (plan.workout_plan.days.length > 6) issues.push('More than 6 training days');
  }
  return issues;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-api-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Unknown'}
Program: ${client.program}
Week: ${week_no}

Recent check-ins:
${JSON.stringify(recentCheckins || [], null, 2)}

Previous program (if any):
${JSON.stringify(lastProgram?.[0]?.workout_plan || null, null, 2)}

Adjust based on compliance scores, energy levels, and any reported issues. Progress the training appropriately for week ${week_no}.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let plan;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      plan = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (e) {
      await notifyMaddy(`⚠️ Program generation failed for ${client.name} (Week ${week_no}) - invalid JSON output`);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const issues = validatePlan(plan);
    if (issues.length > 0) {
      await notifyMaddy(
        `⚠️ Program flagged for review\nClient: ${client.name}\nWeek: ${week_no}\nIssues: ${issues.join(', ')}`
      );
      return res.status(200).json({ success: false, flagged: true, issues });
    }

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.weekly_focus || null,
      pdf_url: null
    });

    if (insertError) throw insertError;

    const focusMsg = plan.weekly_focus || `Week ${week_no} plan is ready`;
    await sendTextMessage(client.phone,
      `💪 Your Week ${week_no} program is ready!\n\n📋 Focus: ${focusMsg}\n\n${plan.motivation_note || 'Stay consistent, results will follow!'}`
    );

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
