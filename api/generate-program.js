const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /extreme\s*cut/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /steroid/i,
  /sarm/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i
];

function buildPrompt(client, checkins) {
  const latest = checkins[0];
  const previous = checkins[1];

  let context = `Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Current Week: ${latest ? latest.week_no + 1 : 1}`;

  if (latest) {
    context += `\n\nLatest Check-in (Week ${latest.week_no}):
- Weight: ${latest.weight || 'N/A'} kg
- Waist: ${latest.waist || 'N/A'} cm
- Compliance: ${latest.compliance_score || 'N/A'}/10
- Energy: ${latest.energy || 'N/A'}/10
- Issues: ${latest.issues || 'None reported'}`;
  }

  if (previous) {
    context += `\n\nPrevious Check-in (Week ${previous.week_no}):
- Weight: ${previous.weight || 'N/A'} kg
- Waist: ${previous.waist || 'N/A'} cm
- Compliance: ${previous.compliance_score || 'N/A'}/10
- Energy: ${previous.energy || 'N/A'}/10`;
  }

  return `You are a NASM-certified personal trainer and nutrition coach creating a weekly program for a client.

${context}

Create a detailed, progressive weekly program with:

1. WORKOUT PLAN (JSON format):
   - 5-6 training days with exercises, sets, reps, rest periods
   - Include warm-up and cool-down
   - Progressive overload from previous weeks
   - Adjust based on compliance and energy levels

2. NUTRITION PLAN (JSON format):
   - Daily calorie target and macro split
   - Meal timing recommendations
   - 3 main meals + 2 snacks framework
   - Hydration target

3. NOTES: One-liner motivational context note for WhatsApp delivery

Respond ONLY in valid JSON:
{
  "workout_plan": { "days": [...] },
  "nutrition_plan": { "calories": ..., "protein": ..., "carbs": ..., "fat": ..., "meals": [...] },
  "notes": "..."
}

RULES:
- Never recommend fewer than 1400 calories for women or 1600 for men
- Never recommend banned substances or supplements requiring medical supervision
- Keep timelines realistic (0.5-1kg/week fat loss max)
- If client reports pain or medical issues, note "CONSULT PHYSICIAN" in notes`;
}

function validateProgram(programData) {
  const str = JSON.stringify(programData).toLowerCase();
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(str)) {
      return { safe: false, reason: `Flagged pattern: ${pattern}` };
    }
  }

  if (programData.nutrition_plan?.calories && programData.nutrition_plan.calories < 1200) {
    return { safe: false, reason: 'Calorie target below safe minimum' };
  }

  return { safe: true };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const prompt = buildPrompt(client, checkins || []);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      console.error('Claude API error:', errBody);
      return res.status(502).json({ error: 'Program generation failed' });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (e) {
      console.error('Failed to parse Claude response as JSON');
      return res.status(502).json({ error: 'Invalid program format from AI' });
    }

    const validation = validateProgram(programData);
    if (!validation.safe) {
      const { createEscalation } = require('./lib/escalation');
      await createEscalation(
        client.phone,
        `Unsafe program flagged: ${validation.reason}`,
        `Week ${week_no} program for client ${client_id}`
      );
      return res.status(422).json({ error: 'Program flagged for review', reason: validation.reason });
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Week ${week_no}`,
        programData.notes || 'Your new program is ready!'
      ]
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.json({ ok: true, program_id: program?.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
