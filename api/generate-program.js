const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { buildProgramPDF, uploadPDF } = require('../lib/pdf');
const { sendTemplate } = require('../lib/whatsapp');

const UNSAFE_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /anabolic/i,
  /steroid/i,
  /lose\s*\d{2,}\s*kg.*week/i,
];

function isSafe(text) {
  return !UNSAFE_PATTERNS.some((p) => p.test(text));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Design a week's training and nutrition plan. Output valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      { "name": "Day 1 - Push", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s" }], "notes": "..." }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "macros": { "protein": 150, "carbs": 200, "fats": 65 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["Oats 50g", "Whey 30g", "Banana 1"] }
    ],
    "notes": "..."
  },
  "coach_notes": "1-2 sentences of encouragement and focus for this week."
}

Rules:
- Never prescribe below 1200 calories for women or 1500 for men.
- Never suggest banned substances, extreme restrictions, or unrealistic timelines.
- Adjust based on previous check-in data (compliance, energy, weight trends).
- Be progressive: slightly increase volume/intensity each week.
- Keep it practical for the client's available equipment and schedule.`;

    const userPrompt = `Client: ${client.name || 'Client'}
Program: ${client.program}
Week: ${week_no}

Recent check-ins: ${JSON.stringify(recentCheckins || [])}
Previous program: ${JSON.stringify(prevPrograms?.[0] || 'None — this is week 1')}

Generate the Week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = response.content[0].text;

    if (!isSafe(raw)) {
      const { escalate } = require('../lib/escalation');
      await escalate(client.phone, 'Unsafe program content flagged by safety check', raw.slice(0, 200));
      return res.status(400).json({ error: 'Program flagged for safety review' });
    }

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const pdfBuffer = await buildProgramPDF(
      client.name || 'Client',
      week_no,
      parsed.workout_plan,
      parsed.nutrition_plan,
      parsed.coach_notes
    );

    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_notes,
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      parsed.coach_notes || 'New program ready!',
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
