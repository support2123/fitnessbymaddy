const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers['x-api-key'];
  if (auth !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client || client.status !== 'active') {
    return res.status(404).json({ error: 'Active client not found' });
  }

  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: intake } = await db
    .from('intake_forms')
    .select('*')
    .eq('lead_id', client.lead_id)
    .single();

  const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a certified personal trainer and nutrition coach creating weekly fitness programs.
You work for FitnessByMaddy, an elite online coaching brand.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned/illegal substances
- Never promise specific weight loss timelines
- If client reports pain/injury, recommend rest and medical consultation
- Programs should be progressive — build on previous weeks
- Include warm-up and cool-down in every workout
- Nutrition should be practical and culturally appropriate for the client's market

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-liner context for this week"
}`;

  const userPrompt = buildUserPrompt(client, intake, checkins, week_no);

  let programData;
  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Program generation failed', detail: e.message });
  }

  if (isSafeProgram(programData) === false) {
    await escalateToMaddy(
      'Unsafe program generated — needs review',
      `Client: ${client.name} | Week ${week_no}`
    );
    return res.status(200).json({ flagged: true, message: 'Program flagged for Maddy review' });
  }

  const { error: insertError } = await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: null,
    whatsapp_sent_at: null,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.notes || ''
  });

  if (insertError) {
    return res.status(500).json({ error: 'Failed to save program' });
  }

  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no),
    programData.notes || 'New week, new gains!'
  ]);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString()
  }).eq('client_id', client_id).eq('week_no', week_no);

  return res.status(200).json({ success: true, week_no, program: programData });
};

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Create Week ${weekNo} program for client:\n`;
  prompt += `- Name: ${client.name}\n`;
  prompt += `- Program: ${client.program}\n`;

  if (intake) {
    prompt += `- Age: ${intake.age || 'unknown'}\n`;
    prompt += `- Gender: ${intake.gender || 'unknown'}\n`;
    prompt += `- Goal: ${intake.goal || 'general fitness'}\n`;
    prompt += `- Injuries: ${intake.injuries || 'none reported'}\n`;
    prompt += `- Diet preference: ${intake.diet_preference || 'no preference'}\n`;
    prompt += `- Schedule: ${intake.schedule || 'flexible'}\n`;
    prompt += `- Experience: ${intake.experience_level || 'intermediate'}\n`;
    prompt += `- Current weight: ${intake.current_weight || 'unknown'}\n`;
    prompt += `- Target weight: ${intake.target_weight || 'unknown'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    checkins.forEach(c => {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, `;
      prompt += `Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    });
  }

  if (weekNo > 1) {
    prompt += `\nThis is week ${weekNo} — progressively increase intensity from last week.`;
  }

  return prompt;
}

function isSafeProgram(data) {
  if (!data || !data.nutrition_plan) return false;
  const cal = data.nutrition_plan.calories;
  if (cal && cal < 1200) return false;

  const notes = JSON.stringify(data).toLowerCase();
  const banned = ['steroids', 'sarms', 'clenbuterol', 'dnp', 'ephedra'];
  if (banned.some(b => notes.includes(b))) return false;

  return true;
}
