const { getSupabase } = require('./_lib/supabase');
const { generateProgramPDF } = require('./_lib/pdf');
const { sendWhatsApp } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'ephedra', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(f => lower.includes(f));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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
    .limit(1);

  if (!client || client.length === 0) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: prevPrograms } = await db
    .from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(1);

  const clientData = client[0];
  const prompt = buildPrompt(clientData, recentCheckins || [], prevPrograms || [], week_no);

  let programData;
  try {
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

    const claudeResult = await claudeRes.json();
    const responseText = claudeResult.content[0].text;

    if (hasSafetyIssue(responseText)) {
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy({
        reason: 'Safety flag in generated program',
        phone: clientData.phone,
        details: `Week ${week_no} program contained risky content. Halted for review.`
      });
      return res.status(200).json({ action: 'halted_for_review', reason: 'safety_flag' });
    }

    const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      programData = JSON.parse(jsonMatch[1]);
    } else {
      programData = JSON.parse(responseText);
    }
  } catch (e) {
    console.error('Claude API error:', e.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  const workoutPlan = programData.workout_plan || programData.workout || {};
  const nutritionPlan = programData.nutrition_plan || programData.nutrition || {};
  const notes = programData.notes || programData.coach_notes || '';

  const pdfBuffer = await generateProgramPDF({
    clientName: clientData.name || 'Client',
    weekNo: week_no,
    workoutPlan,
    nutritionPlan,
    notes
  });

  const filePath = `${client_id}/week_${week_no}.pdf`;
  await db.storage.from('clients').upload(filePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true
  });

  const { data: publicUrl } = db.storage.from('clients').getPublicUrl(filePath);

  await db.from('programs').insert({
    client_id,
    week_no,
    pdf_url: publicUrl.publicUrl || filePath,
    workout_plan: workoutPlan,
    nutrition_plan: nutritionPlan,
    notes
  });

  const contextNote = notes
    ? notes.slice(0, 150)
    : `Week ${week_no} program ready. Let's keep pushing! 💪`;

  await sendWhatsApp({
    phone: clientData.phone,
    body: `Your Week ${week_no} program is ready! 📋\n\n${contextNote}\n\nPDF: ${publicUrl.publicUrl || 'Check your client portal'}`
  });

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ success: true, week_no, pdf_url: publicUrl.publicUrl });
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  const prevSummary = prevPrograms.length > 0
    ? `Previous program notes: ${prevPrograms[0].notes || 'none'}`
    : 'This is the first week.';

  return `You are a certified fitness coach creating a weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Current Week: ${weekNo}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

PREVIOUS PROGRAM:
${prevSummary}

INSTRUCTIONS:
1. Create a complete 7-day workout plan appropriate for week ${weekNo}
2. Create a daily nutrition plan with meals and macros
3. Add coach notes with focus areas and motivation
4. Progress difficulty appropriately based on check-in data
5. If compliance is low, simplify. If energy is low, reduce volume.
6. NEVER prescribe extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
7. NEVER recommend banned substances or unrealistic timelines

Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "" }
        ],
        "notes": ""
      }
    ]
  },
  "nutrition_plan": {
    "meals": [
      { "name": "Breakfast", "time": "7:00 AM", "items": ["Oats 50g", "Protein shake"], "notes": "" }
    ],
    "macros": { "calories": 2000, "protein": 150, "carbs": 200, "fat": 65 }
  },
  "notes": "Coach notes here"
}
\`\`\``;
}
