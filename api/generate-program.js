const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/program-pdf');
const { sendMedia } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect working for Fitness by Maddy, an elite online coaching brand. You create science-based, personalised weekly workout and nutrition plans.

RULES:
- Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned or unregulated supplements
- Never promise specific weight loss timelines
- Scale progressively based on check-in data
- Account for injuries, diet preferences, and energy levels
- For PCOS clients: prioritize insulin sensitivity, strength training, anti-inflammatory foods
- For 40+ clients: prioritize joint-friendly movements, recovery, bone density

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": "4 sets", "reps": "8-10 reps", "rest": "90s rest" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 1800,
    "macros": { "protein": 140, "carbs": 180, "fat": 60 },
    "meals": [
      {
        "name": "Breakfast",
        "items": ["3 eggs scrambled with spinach", "1 toast whole wheat", "Black coffee"]
      }
    ]
  },
  "notes": "Coach's note about this week's focus, max 3 sentences."
}`;

    const userPrompt = buildUserPrompt(client, recentCheckins, prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    if (containsRiskyContent(parsed)) {
      const { escalate } = require('../lib/escalation');
      await escalate(client.phone, 'Risky program content flagged', `Week ${week_no} program for client ${client_id}`);
      return res.status(422).json({ error: 'Program flagged for review' });
    }

    const pdfUrl = await generateProgramPDF(
      client_id,
      week_no,
      parsed.workout_plan,
      parsed.nutrition_plan,
      parsed.notes
    );

    await db.from('programs').upsert(
      {
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.notes,
      },
      { onConflict: 'client_id,week_no' }
    );

    await sendMedia(
      client.phone,
      pdfUrl,
      `Week ${week_no} program is ready! 💪 Check it out.`
    );

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ ok: true, pdf_url: pdfUrl, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, checkins, prevProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Goal: ${client.goal || 'General fitness'}\n`;
  prompt += `Age: ${client.age || 'Unknown'}\n`;
  prompt += `Injuries: ${client.injuries || 'None reported'}\n`;
  prompt += `Diet preference: ${client.diet_pref || 'No restriction'}\n`;
  prompt += `Schedule: ${client.schedule || 'Flexible'}\n\n`;

  if (checkins && checkins.length > 0) {
    prompt += `Recent check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  if (prevProgram) {
    prompt += `\nLast week's calories: ${prevProgram.nutrition_plan?.calories || 'N/A'}\n`;
    prompt += `Last week's notes: ${prevProgram.notes || 'None'}\n`;
  }

  return prompt;
}

function containsRiskyContent(parsed) {
  const cal = parsed?.nutrition_plan?.calories;
  if (cal && cal < 1200) return true;

  const notes = (parsed?.notes || '').toLowerCase();
  const risky = ['steroid', 'dnp', 'clenbuterol', 'ephedra', 'sarm', 'hgh'];
  for (const r of risky) {
    if (notes.includes(r)) return true;
  }

  return false;
}
