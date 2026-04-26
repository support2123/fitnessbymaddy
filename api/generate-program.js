const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const UNSAFE_PATTERNS = [
  /under\s*\d{3}\s*cal/i,
  /\b(dnp|clenbuterol|ephedra|sarm|steroid)\b/i,
  /lose\s*\d+\s*(kg|lb|pound).*\b(day|week)\b/i,
  /starvation/i,
  /extreme\s*calorie\s*cut/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeData } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let profile = {};
    if (intakeData && intakeData.body) {
      try { profile = JSON.parse(intakeData.body); } catch (e) { /* ignore */ }
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are the "Program Architect" for Fitness by Maddy, an elite online coaching brand.
Generate a complete weekly workout + nutrition plan in JSON format.
Be science-backed, safe, and progressive. Adjust based on check-in data.
Never recommend banned substances, extreme caloric restriction (<1200cal for women, <1500cal for men), or unrealistic timelines.
Always include warm-up, cool-down, and rest days.`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${profile.goal ? `- Goal: ${profile.goal}` : ''}
${profile.experience ? `- Experience: ${profile.experience}` : ''}
${profile.injuries ? `- Injuries/Limitations: ${profile.injuries}` : ''}
${profile.diet_pref ? `- Diet Preference: ${profile.diet_pref}` : ''}
${profile.current_weight ? `- Current Weight: ${profile.current_weight}` : ''}
${profile.target_weight ? `- Target Weight: ${profile.target_weight}` : ''}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')
  : 'No previous check-ins yet (first week)'}

Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }], "warmup": "...", "cooldown": "..." },
      ...
    ],
    "rest_days": ["Wednesday", "Sunday"]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 73,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "notes": "" },
      ...
    ],
    "hydration": "3-4L water daily",
    "supplements": ["..."]
  },
  "weekly_note": "One sentence motivational/coaching note for the client"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const rawText = JSON.stringify(programData);
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(rawText)) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy('Potentially unsafe program content flagged', {
          phone: client.phone,
          name: client.name,
          message: `Week ${week_no} program flagged by safety check: ${pattern.toString()}`
        });
        return res.status(200).json({
          success: false,
          flagged: true,
          reason: 'Content flagged for Maddy review'
        });
      }
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_note || null,
      pdf_url: null
    }).select().single();

    const weeklyNote = programData.weekly_note || `Week ${week_no} program is ready!`;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      weeklyNote
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
