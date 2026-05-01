const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./send-whatsapp');
const { maskPhone, jsonResponse, cors } = require('./lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 calories', 'under 800 calories',
  'banned substance', 'steroid', 'ephedrine', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'crash diet', 'water fast'
];

function buildPrompt(client, checkins, weekNo) {
  const lastTwo = checkins.slice(-2);
  const history = lastTwo.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}in, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand.

Client Profile:
- Name: ${client.name}
- Program: 12-Week Custom Flagship
- Current Week: ${weekNo}
- Phone: [REDACTED]

Recent Check-in Data:
${history || 'No previous check-ins (Week 1)'}

Create a complete weekly program for Week ${weekNo}. Output valid JSON with this exact structure:
{
  "workout_plan": {
    "split": "push/pull/legs" or similar,
    "days": [
      {
        "day": "Day 1 - Push",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min LISS post-workout"
      }
    ],
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fats_g": 70,
    "meal_timing": ["Pre-workout: ...", "Post-workout: ..."],
    "hydration": "3-4L water daily",
    "supplements": ["Creatine 5g", "Vitamin D 2000IU"]
  },
  "weekly_focus": "Brief 1-2 sentence focus for this week",
  "coach_note": "Brief personalised note from coach to client"
}

Rules:
- Program must be progressive (build on previous weeks)
- If compliance was low, slightly reduce volume but maintain intensity
- If energy was low, check nutrition adequacy and add recovery notes
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned/dangerous substances
- Keep it evidence-based, no bro-science
- Be warm and encouraging in coach_note`;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return jsonResponse(res, 400, { error: 'client_id and week_no required' });
  }

  const supabase = getSupabase();

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return jsonResponse(res, 404, { error: 'Client not found' });

  const { data: checkins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: true });

  const prompt = buildPrompt(client, checkins || [], week_no);

  const anthropic = new Anthropic();
  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    console.error('Claude API error:', e.message);
    return jsonResponse(res, 500, { error: 'AI generation failed' });
  }

  const raw = response.content[0]?.text || '';

  const hasSafetyFlag = SAFETY_FLAGS.some(f => raw.toLowerCase().includes(f));
  if (hasSafetyFlag) {
    await sendWhatsApp({
      phone: '+' + (process.env.MADDY_PHONE || '917082478374'),
      templateName: 'escalation_alert',
      bodyValues: [
        client.name || 'Client',
        `Week ${week_no} program flagged for safety review. Please check admin dashboard.`
      ],
      isClient: true,
    });

    await supabase.from('programs').insert({
      client_id, week_no,
      workout_plan: {},
      nutrition_plan: {},
      notes: `SAFETY FLAG - needs manual review. Raw output stored.`,
    });

    console.log(`Safety flag: client=${client_id} week=${week_no}`);
    return jsonResponse(res, 200, { success: false, reason: 'safety_flagged' });
  }

  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('JSON parse failed for program output');
    return jsonResponse(res, 500, { error: 'Failed to parse program' });
  }

  const { data: program } = await supabase.from('programs').insert({
    client_id,
    week_no,
    workout_plan: parsed.workout_plan || {},
    nutrition_plan: parsed.nutrition_plan || {},
    notes: parsed.coach_note || '',
  }).select().single();

  if (client.phone) {
    const focus = parsed.weekly_focus || `Week ${week_no} program is ready!`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [client.name || 'there', `Week ${week_no}`, focus],
      isClient: true,
    });

    if (program) {
      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('id', program.id);
    }
  }

  console.log(`Program generated: client=${client_id} week=${week_no}`);
  return jsonResponse(res, 200, { success: true, programId: program?.id });
};
