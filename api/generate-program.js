const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet', 'starvation'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

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

    const { data: lastProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    const anthropic = new Anthropic();

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
You create weekly personalized workout and nutrition plans.

RULES:
- Plans must be safe, evidence-based, and realistic
- Never recommend extreme calorie restrictions (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, steroids, or dangerous supplements
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Tailor to client's injuries, conditions, and preferences
- Progressive overload each week based on check-in data
- Include rest days (minimum 1-2 per week)

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS or HIIT", "duration": "20-30min" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] },
      ...
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "notes": "Brief coaching note for the client"
}`;

    const userPrompt = buildUserPrompt(client, recentCheckins, lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawOutput = response.content[0]?.text || '';

    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    let programData;
    try {
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Invalid JSON from program generator' });
    }

    const outputStr = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => outputStr.includes(flag));
    if (flagged) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: 'Safety flag in generated program',
        phone: client.phone,
        clientName: client.name,
        message: `Week ${week_no} program flagged for review`
      });
      return res.status(200).json({ ok: true, flagged: true, message: 'Flagged for Maddy review' });
    }

    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
      pdf_url: null
    });

    if (progErr) {
      console.error('Program insert error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const msg = hinglish
      ? `Week ${week_no} ka program ready hai! 💪\n\n${programData.notes || 'Is hafte focus rakhna — results aa rahe hain!'}\n\nPlan check karo aur doubts ho toh batao.`
      : `Your Week ${week_no} program is ready! 💪\n\n${programData.notes || 'Stay focused this week — results are coming!'}\n\nCheck your plan and let us know if you have questions.`;

    await sendWhatsApp({ phone: client.phone, message: msg, templateName: 'weekly_program' });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, program: programData });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

function buildUserPrompt(client, checkins, lastProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Started: ${client.program_started_at}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: "${c.issues}"`;
      if (c.next_week_focus) prompt += `, focus: "${c.next_week_focus}"`;
      prompt += '\n';
    }
  } else {
    prompt += '\nNo previous check-ins (first week).\n';
  }

  if (lastProgram) {
    prompt += `\nLast week's plan summary:\n`;
    prompt += `  Workout: ${JSON.stringify(lastProgram.workout_plan).slice(0, 500)}\n`;
    prompt += `  Nutrition calories: ${lastProgram.nutrition_plan?.calories || 'N/A'}\n`;
    if (lastProgram.notes) prompt += `  Notes: ${lastProgram.notes}\n`;
  }

  prompt += `\nGenerate an appropriate progression for Week ${weekNo}. Return JSON only.`;
  return prompt;
}
