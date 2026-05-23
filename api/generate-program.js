const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

const RISKY_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /extreme\s*(cut|deficit|fast)/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*(in|per)\s*(a\s*)?week/i,
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

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

  const { data: lastProgram } = await db
    .from('programs')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(1)
    .single();

  const prompt = buildProgramPrompt(client, recentCheckins || [], lastProgram, week_no);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }
    programData = JSON.parse(jsonMatch[1]);
  } catch (e) {
    return res.status(500).json({ error: 'Program generation failed', details: e.message });
  }

  const fullText = JSON.stringify(programData);
  const isRisky = RISKY_PATTERNS.some(p => p.test(fullText));

  if (isRisky) {
    await escalateToMaddy({
      reason: 'risky_program_content',
      phone: client.phone,
      name: client.name,
      message: `Week ${week_no} program flagged for review — potentially risky content detected.`,
    });
    return res.status(200).json({
      ok: true, flagged: true,
      message: 'Program flagged for Maddy review before sending',
    });
  }

  const { data: program, error: insertErr } = await db.from('programs').insert({
    client_id,
    week_no,
    workout_plan: programData.workout_plan || programData.workouts || {},
    nutrition_plan: programData.nutrition_plan || programData.nutrition || {},
    notes: programData.coach_notes || programData.notes || '',
  }).select().single();

  if (insertErr) {
    return res.status(500).json({ error: 'Failed to save program', details: insertErr.message });
  }

  const summary = programData.coach_notes || programData.weekly_summary ||
    `Week ${week_no} program is ready!`;

  await sendWhatsApp({
    phone: client.phone,
    message: `Hey ${client.name || 'there'}! Your Week ${week_no} program is ready.\n\n${summary}\n\nFull plan has been uploaded. Let's crush this week!`,
  });

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('id', program.id);

  return res.status(200).json({ ok: true, program_id: program.id });
};

function buildProgramPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a NASM-certified program architect for Fitness by Maddy.
Generate a Week ${weekNo} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'Body transformation'}
- Injuries/limitations: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

${lastProgram ? `LAST WEEK'S FOCUS: ${lastProgram.notes || 'Standard progression'}` : ''}

RULES:
- Be science-based. No bro-science.
- Never prescribe below 1400 cal for women or 1600 for men.
- No banned substances or supplements.
- Set realistic weekly targets (0.5-1kg loss max).
- If injuries reported, provide modifications.
- Warm + expert tone, Hinglish acceptable for Indian clients.

Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": "3x 20min LISS or 2x 15min HIIT"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meal_timing": ["Pre-workout: ...", "Post-workout: ..."],
    "notes": "..."
  },
  "coach_notes": "One-liner summary and motivation for the week",
  "weekly_summary": "Brief overview of what changed from last week and why"
}
\`\`\``;
}
