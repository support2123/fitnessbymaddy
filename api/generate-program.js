const { getClient } = require('../lib/supabase');
const { sendMessage } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'banned substance', 'steroid',
  'anabolic', 'clenbuterol', 'dnp', 'ephedra', 'sarm',
  'lose 10kg in 1 week', 'crash diet', 'water fast'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
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
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

function buildPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  return `You are "Program Architect" for Fitness by Maddy — a NASM-certified trainer with 10+ years experience.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Current weight: ${lastCheckin.weight || 'N/A'}
- Previous weight: ${prevCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues reported: ${lastCheckin.issues || 'None'}
- Focus for this week: ${lastCheckin.next_week_focus || 'General improvement'}

Generate a personalized weekly program in valid JSON with this exact structure:
{
  "workout_plan": {
    "overview": "Brief week overview (1-2 sentences)",
    "days": [
      {
        "day": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Exercise", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ],
        "cardio": "Optional cardio note"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meals": [
      { "meal": "Meal 1 - Breakfast", "options": ["Option A", "Option B"] }
    ],
    "hydration": "Water intake note",
    "supplements": ["Only basic evidence-based supplements"]
  },
  "coach_note": "Motivational 1-2 line note from Maddy"
}

RULES:
- Safe, science-backed programming only
- Never suggest extreme caloric restriction (minimum 1200 cal women, 1500 cal men)
- No banned substances, no steroids, no dangerous supplements
- Adjust intensity based on compliance and energy scores
- If compliance is low, reduce volume slightly and add motivational note
- Respond ONLY with the JSON, no markdown wrapping`;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getClient();

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

    const prompt = buildPrompt(client, checkins || [], week_no);
    const rawResponse = await callClaude(prompt);

    if (hasSafetyIssue(rawResponse)) {
      const { sendMessage: notify } = require('../lib/whatsapp');
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy('Unsafe program content flagged by AI', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program contained safety flags. Review required before sending.`
      });

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: { flagged: true, raw: rawResponse },
        nutrition_plan: { flagged: true },
        notes: 'FLAGGED — awaiting Maddy review'
      });

      return res.status(200).json({ success: true, flagged: true });
    }

    let parsed;
    try {
      const cleaned = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const pdfContent = JSON.stringify(parsed, null, 2);
    const pdfPath = `${client.folder_url || `clients/${client_id}`}/week_${week_no}.json`;

    await db.storage.from('programs').upload(pdfPath, pdfContent, {
      contentType: 'application/json',
      upsert: true
    });

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null
    }).select().single();

    const coachNote = parsed.coach_note || "Let's crush this week! 💪";
    await sendMessage(client.phone, `Week ${week_no} program is ready! 🔥\n\n${coachNote}\n\nCheck your program details in the app.`, {
      isClient: true,
      templateName: 'weekly_program',
      params: {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(week_no), coachNote]
      }
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
