const { getSupabase } = require('../lib/supabase');
const { sendText, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const { escalateToMaddy } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk').default;

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = {};
    try {
      if (lead?.first_msg) intakeData = JSON.parse(lead.first_msg);
    } catch {}

    const checkinSummary = (recentCheckins || []).map(c =>
      `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, ` +
      `Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10, ` +
      `Issues: ${c.issues || 'None'}`
    ).join('\n');

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
Create science-based, safe, progressive training and nutrition plans.
NEVER recommend: extreme calorie restriction (<1200 cal for women, <1500 for men),
banned substances, unrealistic timelines, or anything medically risky.
Always include rest days and progressive overload principles.
Output valid JSON only — no markdown, no code fences.`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Name: ${client.name || 'Client'}
Program: ${client.program}
Started: ${client.program_started_at}

Intake data: ${JSON.stringify(intakeData)}

Recent check-ins:
${checkinSummary || 'No previous check-ins (first week)'}

Return JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "15 min incline walk"
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "notes": "Progressive overload from last week"
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option A description", "Option B description"] }
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": "Adjusted based on compliance and energy"
  },
  "weekly_notes": "Focus area and motivation for this week",
  "context_note": "One-liner for WhatsApp message"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    if (hasSafetyIssue(rawText)) {
      await escalateToMaddy(
        'Safety flag in generated program',
        client.phone,
        `Week ${week_no} program contains potentially risky content. Review required.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_review_needed' });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse Claude response as JSON');
      }
    }

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.weekly_notes || parsed.context_note,
    });

    if (insertError) {
      console.error('[Program DB Error]', insertError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = parsed.context_note || `Week ${week_no} program is ready!`;
    const waMsg = `💪 Your Week ${week_no} program is here!\n\n${contextNote}\n\nCheck your program in the client portal. Questions? Reply here!`;

    await sendText(client.phone, waMsg);
    await logMessage(client.phone, 'out', waMsg, 'program_delivery');

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({ ok: true, week_no });
  } catch (err) {
    console.error('[Generate Program Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
