const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { parseBody, cors, maskPhone } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm|steroid/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i,
  /extreme\s*(cut|deficit|fast)/i
];

function auditProgramSafety(plan) {
  const text = JSON.stringify(plan);
  for (const pattern of RISKY_PATTERNS) {
    if (pattern.test(text)) return pattern.toString();
  }
  return null;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified personal trainer and sports nutritionist creating weekly programs for Fitness by Maddy clients. You must output valid JSON only — no markdown, no explanation.

Output format:
{
  "workout_plan": {
    "days": [
      {"day": "Monday", "focus": "Upper Body Push", "exercises": [
        {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
      ]},
      ...
    ],
    "cardio": {"type": "LISS", "frequency": "3x/week", "duration": "25 min"},
    "notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 165,
    "carbs_g": 250,
    "fat_g": 70,
    "meals": [
      {"meal": "Breakfast", "options": ["Option A...", "Option B..."]},
      ...
    ],
    "supplements": ["Creatine 5g", "Whey 1 scoop"],
    "hydration": "3L minimum",
    "notes": ""
  },
  "coach_note": "One-liner context for WhatsApp delivery"
}

Rules:
- Never recommend under 1400 calories for women or 1600 for men
- Never recommend banned substances, SARMs, or extreme protocols
- Progressively overload from previous weeks
- Account for any injuries or issues reported in check-ins
- Keep it practical — exercises should be doable in a standard gym`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Unknown'}
- Injuries: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Standard'}

${recentCheckins && recentCheckins.length > 0 ? `Recent Check-ins:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins available (this is week 1).'}

Generate the complete Week ${week_no} program as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      system: systemPrompt
    });

    const rawOutput = response.content[0].text;
    let program;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      program = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch (parseErr) {
      console.error('[Program] Failed to parse Claude output');
      return res.status(500).json({ error: 'Program generation parse error' });
    }

    const safetyFlag = auditProgramSafety(program);
    if (safetyFlag) {
      await escalate(
        'Program safety flag',
        client.phone,
        `Week ${week_no} flagged by pattern: ${safetyFlag}`
      );
      return res.status(200).json({
        ok: false,
        flagged: true,
        reason: 'Program flagged for Maddy review',
        pattern: safetyFlag
      });
    }

    const { data: programRecord, error: insertErr } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: program.coach_note || null
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[Program] Insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const coachNote = program.coach_note || `Week ${week_no} program is ready!`;
    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(week_no), coachNote]
    }, `Week ${week_no}: ${coachNote}`);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', programRecord.id);

    console.log(`[Program] Generated Week ${week_no} for ${maskPhone(client.phone)}`);
    return res.status(200).json({ ok: true, program_id: programRecord.id, week_no });
  } catch (err) {
    console.error('[Generate Program] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
