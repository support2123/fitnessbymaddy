const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { maskPhone, cors } = require('../lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const PROGRAM_ARCHITECT_PROMPT = `You are Maddy's AI program architect for FitnessByMaddy.
You design weekly workout and nutrition plans for real coaching clients.

RULES:
- Evidence-based programming only. No bro-science.
- Never prescribe extreme calorie deficits below 1200 kcal for women or 1500 kcal for men.
- Never recommend banned substances or extreme supplementation.
- Never promise specific weight loss timelines.
- Progressive overload principles. Vary rep ranges.
- Account for injuries and limitations noted in client data.
- Nutrition: practical, flexible, culturally appropriate.
- Format output as valid JSON with workout_plan and nutrition_plan keys.

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min steady state"
      }
    ],
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 60,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "..." }
    ],
    "hydration": "3L daily",
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": ""
  },
  "coach_note": "One line summary for WhatsApp message"
}`;

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

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

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    let intakeData = null;
    if (client.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      if (lead && lead.first_msg) {
        try { intakeData = JSON.parse(lead.first_msg); } catch (_) {}
      }
    }

    const clientContext = `
CLIENT PROFILE:
- Name: ${client.name || 'Unknown'}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
- Start date: ${client.program_started_at}
${intakeData ? `- Age: ${intakeData.age || 'N/A'}
- Goal: ${intakeData.goal || 'N/A'}
- Injuries: ${intakeData.injuries || 'None reported'}
- Diet preference: ${intakeData.diet_pref || 'No restriction'}
- Schedule: ${intakeData.schedule || 'Flexible'}
- Experience: ${intakeData.experience || 'N/A'}` : ''}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues=${c.issues || 'none'}`).join('\n')
  : 'No check-in data yet (first week)'}

${lastProgram ? `LAST PROGRAM (Week ${lastProgram.week_no}):
${JSON.stringify(lastProgram.workout_plan || {}, null, 2).slice(0, 500)}` : 'No previous program.'}

Generate the Week ${week_no} program. Adjust based on check-in data if available.`;

    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: PROGRAM_ARCHITECT_PROMPT,
      messages: [{ role: 'user', content: clientContext }]
    });

    const responseText = response.content[0].text;

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse program JSON:', parseErr.message);
      await sendText(MADDY_PHONE,
        `PROGRAM GEN FAILED for ${client.name || maskPhone(client.phone)}\n` +
        `Week ${week_no} - JSON parse error. Manual review needed.`
      );
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    const safetyFlags = [];
    const np = programData.nutrition_plan || {};
    if (np.calories && np.calories < 1200) safetyFlags.push('Calories below 1200');
    const supplements = (np.supplements || []).join(' ').toLowerCase();
    if (/steroid|sarm|dnp|clenbuterol|ephedra/i.test(supplements)) {
      safetyFlags.push('Banned substance detected');
    }

    if (safetyFlags.length > 0) {
      await sendText(MADDY_PHONE,
        `SAFETY FLAG on program for ${client.name || maskPhone(client.phone)}\n` +
        `Week ${week_no}: ${safetyFlags.join(', ')}\n` +
        `Program NOT sent. Please review and send manually.`
      );
      await supabase.from('programs').insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: programData.workout_plan || null,
        nutrition_plan: programData.nutrition_plan || null,
        notes: `HELD: ${safetyFlags.join(', ')}`
      });
      return res.status(200).json({ ok: true, held: true, flags: safetyFlags });
    }

    const { error: insertErr } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout_plan || null,
      nutrition_plan: programData.nutrition_plan || null,
      notes: programData.coach_note || null
    });

    if (insertErr) throw insertErr;

    const coachNote = programData.coach_note || `Your Week ${week_no} program is ready!`;

    await sendText(client.phone,
      `Week ${week_no} Program Update\n\n` +
      `${coachNote}\n\n` +
      `Your updated plan has been generated. Check your dashboard or reply "plan" to get details.`
    );

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    console.log(`Program generated: ${maskPhone(client.phone)} week=${week_no}`);
    return res.status(200).json({ ok: true, week_no });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
