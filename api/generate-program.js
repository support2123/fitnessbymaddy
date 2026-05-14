const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic steroid',
  'lose 10kg in a week', 'lose 20 pounds in a week',
  'starvation', 'very low calorie diet'
];

function checkSafety(plan) {
  const text = JSON.stringify(plan).toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (text.includes(flag)) return { safe: false, flag };
  }
  return { safe: true };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = {};
    if (lead?.first_msg) {
      try { intakeData = JSON.parse(lead.first_msg); } catch {}
    }

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for Fitness by Maddy.
You create personalized weekly workout and nutrition plans based on client data.

RULES:
- Never prescribe fewer than 1200 calories/day for women or 1500 for men
- Never recommend banned substances, steroids, or unregulated supplements
- Never promise specific weight loss timelines (e.g., "lose 10kg in 2 weeks")
- Always include rest days (minimum 1-2 per week)
- Always include warm-up and cool-down in workout plans
- Adapt to injuries and medical conditions — when in doubt, recommend lighter alternatives
- Keep nutrition practical and sustainable — no extreme elimination diets

OUTPUT FORMAT: Respond ONLY with valid JSON matching this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "warmup": "...",
    "cooldown": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "Brief week-specific coaching note for the client"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intakeData.age ? `- Age: ${intakeData.age}` : ''}
${intakeData.gender ? `- Gender: ${intakeData.gender}` : ''}
${intakeData.goal ? `- Goal: ${intakeData.goal}` : ''}
${intakeData.experience ? `- Experience: ${intakeData.experience}` : ''}
${intakeData.injuries ? `- Injuries/Limitations: ${intakeData.injuries}` : ''}
${intakeData.diet_pref ? `- Diet Preference: ${intakeData.diet_pref}` : ''}
${intakeData.current_weight ? `- Current Weight: ${intakeData.current_weight}` : ''}
${intakeData.target_weight ? `- Target Weight: ${intakeData.target_weight}` : ''}
${intakeData.medical_conditions ? `- Medical Conditions: ${intakeData.medical_conditions}` : ''}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : 'No previous check-ins (first week)'}

Generate the Week ${week_no} plan now. Progressively increase intensity from previous weeks if check-in data shows good compliance. If compliance is low or energy is low, reduce volume slightly and add notes about recovery.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;
    let plan;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      plan = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const safety = checkSafety(plan);
    if (!safety.safe) {
      await notifyMaddy(
        `Program safety flag: "${safety.flag}"`,
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nFlagged content detected — program NOT sent. Please review.`
      );
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        flag: safety.flag
      });
    }

    const { data: program, error: progErr } = await supabase
      .from('programs')
      .upsert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: plan.workout_plan,
        nutrition_plan: plan.nutrition_plan,
        notes: plan.notes,
        generated_at: new Date().toISOString()
      }, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    if (progErr) {
      console.error('Program save error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const weekSummary = plan.notes || `Week ${week_no} plan is ready!`;
    await sendWhatsApp({
      phone: client.phone,
      body: `Your Week ${week_no} program is ready!\n\n${weekSummary}\n\nFull details available in your client portal. Let us know if you have any questions!`,
      isClient: true
    });

    await supabase
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
    return res.status(500).json({ error: 'Internal error' });
  }
};
