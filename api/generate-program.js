const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const UNSAFE_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /500\s*cal.*deficit/i,
  /extreme.*cut/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose.*10.*kg.*week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  // Get client profile
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Get intake profile
  const { data: intake } = await supabase
    .from('intake_profiles')
    .select('*')
    .eq('lead_id', client.lead_id)
    .single();

  // Get last 2 check-ins
  const { data: checkins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  // Build prompt
  const clientContext = {
    name: client.name,
    program: client.program,
    week: week_no,
    profile: intake || {},
    recentCheckins: checkins || []
  };

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are the program architect for Fitness by Maddy, an elite online coaching brand. Generate weekly workout and nutrition plans that are:
- Evidence-based and safe
- Progressive (building on previous weeks)
- Tailored to the client's profile, goals, and feedback
- Structured as JSON for easy rendering

SAFETY RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or unproven supplements
- Never promise unrealistic timelines (max 1kg/week fat loss)
- If client reports pain/injury, reduce intensity and flag for review

Output format:
{
  "workout_plan": {
    "days": [{ "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }] }],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [{ "meal": "Breakfast", "options": ["...", "..."] }],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-liner context for WhatsApp delivery"
}`;

  const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${JSON.stringify(clientContext, null, 2)}

Consider their recent check-in data for progression/regression adjustments. If this is week 1, build a solid foundation program based on their intake profile.`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
  } catch (err) {
    return res.status(500).json({ error: 'Claude API call failed', detail: err.message });
  }

  const content = response.content[0].text;

  // Extract JSON from response
  let programData;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    programData = JSON.parse(jsonMatch[0]);
  } catch {
    return res.status(500).json({ error: 'Failed to parse program JSON' });
  }

  // Safety check
  const rawText = JSON.stringify(programData);
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(rawText)) {
      const { notifyMaddy } = require('../lib/escalation');
      await notifyMaddy('Unsafe program content flagged', {
        name: client.name,
        phone: client.phone,
        message: `Week ${week_no} program triggered safety filter: ${pattern.source}`
      });
      return res.status(200).json({ action: 'flagged_for_review', pattern: pattern.source });
    }
  }

  // Store program
  const { data: program, error } = await supabase.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.notes || ''
  }).select().single();

  if (error) return res.status(500).json({ error: 'Failed to store program' });

  // Send via WhatsApp
  const note = programData.notes || `Week ${week_no} program is ready!`;
  await sendWhatsApp(client.phone, 'program_ready', {
    name: client.name,
    templateParams: [client.name, String(week_no), note]
  }).catch(() => {});

  await supabase.from('messages').insert({
    phone: client.phone,
    direction: 'out',
    body: `Week ${week_no} program sent`,
    template_name: 'program_ready',
    sent_at: new Date().toISOString(),
    status: 'sent'
  });

  // Update program with sent timestamp
  await supabase.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  return res.status(200).json({ success: true, program_id: program.id });
};
