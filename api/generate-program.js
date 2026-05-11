const { getSupabase } = require('./lib/supabase');
const { sendMessage, maskPhone } = require('./lib/whatsapp');
const { logMessage } = require('./lib/ratelimit');

const MADDY_PHONE = '917082478374';

const SYSTEM_PROMPT = `You are a certified personal trainer and nutrition coach creating a weekly program for a client.
Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS", "duration": "25 min" }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": ["Whey protein post-workout", "Creatine 5g daily"],
    "hydration": "3L minimum"
  },
  "notes": "Focus on progressive overload this week. Increase bench by 2.5kg if last week's sets were completed."
}

RULES:
- Never recommend extreme calorie deficits (below BMR - 500)
- Never recommend banned substances or steroids
- Never promise specific timelines for results
- Adjust based on compliance score and reported issues
- If client reports pain in any area, AVOID exercises loading that area
- Be progressive: increase volume/intensity gradually week over week`;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  if (!client) return res.status(404).json({ error: 'Client not found' });

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
    .limit(1);

  const intake = client.intake_data || {};
  const userPrompt = buildPrompt(client, intake, recentCheckins || [], lastProgram?.[0], week_no);

  let programData;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const result = await response.json();
    const text = result.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('Claude API error:', e.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  if (isUnsafe(programData)) {
    await sendMessage(MADDY_PHONE,
      `⚠️ Program for ${maskPhone(client.phone)} Week ${week_no} flagged for review. Possible unsafe recommendations detected.`
    );
    return res.status(200).json({ flagged: true, reason: 'safety_review' });
  }

  const { data: program, error } = await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.notes,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const market = client.market || 'GLOBAL';
  const contextNote = market === 'IN'
    ? `💪 Week ${week_no} ka plan ready hai! ${programData.notes || ''}`
    : `💪 Week ${week_no} plan is ready! ${programData.notes || ''}`;

  await sendMessage(client.phone, contextNote);
  await logMessage(client.phone, 'out', contextNote, 'weekly_program');

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('id', program.id);

  return res.status(200).json({ success: true, program_id: program.id });
};

function buildPrompt(client, intake, checkins, lastProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake.age) prompt += `Age: ${intake.age}\n`;
  if (intake.gender) prompt += `Gender: ${intake.gender}\n`;
  if (intake.height) prompt += `Height: ${intake.height}\n`;
  if (intake.weight) prompt += `Weight: ${intake.weight}\n`;
  if (intake.goal) prompt += `Goal: ${intake.goal}\n`;
  if (intake.injuries) prompt += `Injuries/Limitations: ${intake.injuries}\n`;
  if (intake.diet_preference) prompt += `Diet: ${intake.diet_preference}\n`;
  if (intake.workout_days) prompt += `Available days: ${intake.workout_days}\n`;
  if (intake.equipment) prompt += `Equipment: ${intake.equipment}\n`;

  if (checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    checkins.forEach(c => {
      prompt += `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, `;
      prompt += `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += `\n`;
    });
  }

  if (lastProgram) {
    prompt += `\nLast week's program notes: ${lastProgram.notes || 'None'}\n`;
  }

  return prompt;
}

function isUnsafe(data) {
  if (!data || !data.nutrition_plan) return false;
  const cals = data.nutrition_plan.calories;
  if (cals && cals < 1000) return true;
  const notes = (data.notes || '').toLowerCase();
  const banned = ['steroid', 'dnp', 'clenbuterol', 'ephedra', 'sarm'];
  return banned.some(b => notes.includes(b));
}
