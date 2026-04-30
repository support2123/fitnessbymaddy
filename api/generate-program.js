const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/pii');
const { notifyMaddy } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1200 calories', 'under 1000 calories', 'extreme', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect for FitnessByMaddy. You create personalized weekly workout and nutrition plans.

RULES:
- Be evidence-based, never bro-science
- Never recommend banned substances or extreme calorie deficits (<1200 cal)
- Adjust based on check-in data (compliance, energy, weight trends)
- Include warm-up and cool-down in every session
- Nutrition must be sustainable and culturally appropriate
- Always include rest days
- Progressive overload week-over-week

OUTPUT FORMAT: Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS or HIIT", "duration": "20-30 min" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 73,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "...", "macros": "..." }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["whey protein", "creatine 5g", "vitamin D"]
  },
  "coach_notes": "Brief note about focus for this week"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Current week: ${week_no}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')
  : 'No check-ins yet (first week)'}

PREVIOUS PLAN:
${prevPrograms && prevPrograms.length > 0
  ? JSON.stringify(prevPrograms[0], null, 2).slice(0, 1000)
  : 'No previous plan (first week)'}

Generate the Week ${week_no} plan now.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude did not return valid JSON');
    }

    const plan = JSON.parse(jsonMatch[0]);

    const planText = JSON.stringify(plan);
    const hasSafetyIssue = SAFETY_FLAGS.some(flag => planText.toLowerCase().includes(flag));
    if (hasSafetyIssue) {
      await notifyMaddy('Program flagged for safety review', {
        client_id,
        client_name: client.name,
        week_no,
        flag: 'Safety content detected in generated plan'
      }, sendWhatsApp);
      return res.status(200).json({
        success: false,
        reason: 'flagged_for_review',
        message: 'Plan flagged for Maddy review before sending'
      });
    }

    const { error } = await supabase.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.coach_notes || null
    }, { onConflict: 'client_id,week_no' });

    if (error) throw error;

    const isHinglish = client.phone.startsWith('91');
    const summaryMsg = isHinglish
      ? `Week ${week_no} ka plan ready hai!\n\n${plan.coach_notes || ''}\n\nCalories: ${plan.nutrition_plan?.calories || 'TBD'}\nProtein: ${plan.nutrition_plan?.protein_g || 'TBD'}g\n\nFull plan check karne ke liye apna dashboard dekho. Questions ho toh yahan poocho!`
      : `Your Week ${week_no} plan is ready!\n\n${plan.coach_notes || ''}\n\nCalories: ${plan.nutrition_plan?.calories || 'TBD'}\nProtein: ${plan.nutrition_plan?.protein_g || 'TBD'}g\n\nCheck your dashboard for the full plan. Questions? Ask here!`;

    await sendWhatsApp(client.phone, summaryMsg);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

    console.log(`Program generated: ${maskPhone(client.phone)} Week ${week_no}`);
    return res.status(200).json({ success: true, week_no, plan });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
