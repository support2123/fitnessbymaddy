const db = require('./_lib/supabase');
const wa = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/utils');

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 calories', 'under 800',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const clients = await db.query('clients', `id=eq.${client_id}&select=*`);
    if (clients.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clients[0];

    const checkins = await db.query(
      'checkins',
      `client_id=eq.${client_id}&order=week_no.desc&limit=2&select=*`
    );

    const prompt = buildPrompt(client, checkins, week_no);

    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} ${errText}`);
    }

    const claudeData = await claudeRes.json();
    const rawOutput = claudeData.content[0].text;

    const flagged = SAFETY_FLAGS.some(f => rawOutput.toLowerCase().includes(f));
    if (flagged) {
      await notifyMaddyForReview(client, week_no, rawOutput);
      return res.status(200).json({ ok: true, flagged: true, needs_review: true });
    }

    let plans;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      plans = jsonMatch ? JSON.parse(jsonMatch[0]) : { workout_plan: rawOutput, nutrition_plan: '' };
    } catch {
      plans = { workout_plan: rawOutput, nutrition_plan: '' };
    }

    const program = (await db.insert('programs', {
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      workout_plan: plans.workout_plan || plans.workout || null,
      nutrition_plan: plans.nutrition_plan || plans.nutrition || null,
      notes: plans.notes || null,
    }))[0];

    try {
      const contextNote = `Week ${week_no} program is ready! Check your plan and message us if you have questions.`;
      await wa.sendTemplate(client.phone, 'weekly_program', [String(week_no), contextNote], client.name || 'there');

      await db.update('programs', { id: program.id }, {
        whatsapp_sent_at: new Date().toISOString(),
      });

      await db.insert('messages', {
        phone: client.phone,
        direction: 'out',
        body: contextNote,
        template_name: 'weekly_program',
        sent_at: new Date().toISOString(),
        status: 'sent',
      });
    } catch (err) {
      console.error(`Program WA send failed for ${maskPhone(client.phone)}:`, err.message);
    }

    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are "Program Architect" — an elite fitness coach AI for FitnessByMaddy.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${client.goal || 'body transformation'}
- Age: ${client.age || 'not specified'}
- Injuries/Limitations: ${client.injuries || 'none reported'}
- Diet Preference: ${client.diet_pref || 'no preference'}
- Schedule: ${client.schedule || 'flexible'}

CURRENT WEEK: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'none'}
- Focus: ${lastCheckin.next_week_focus || 'N/A'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10` : ''}

Generate a complete Week ${weekNo} program. Return ONLY valid JSON:

{
  "workout_plan": {
    "overview": "Brief week overview",
    "days": [
      {
        "day": "Day 1 - Push",
        "exercises": [
          { "name": "Exercise", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "Cardio recommendation",
    "recovery": "Recovery notes"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 60,
    "meal_timing": ["Meal 1 details", "Meal 2 details"],
    "hydration": "Water recommendation",
    "supplements": "Basic supplement suggestions"
  },
  "notes": "Motivational note and key focus for the week"
}

RULES:
- Be science-backed and safe. No extreme deficits below 1200 cal for women or 1500 for men.
- No banned substances or unrealistic timelines.
- Adjust based on compliance and energy from check-ins.
- If energy is low (<=4), reduce volume. If compliance is high (>=8), progress load.
- Account for any injuries or limitations.`;
}

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

async function notifyMaddyForReview(client, weekNo, rawOutput) {
  const alert = `⚠️ PROGRAM REVIEW NEEDED\nClient: ${client.name || maskPhone(client.phone)}\nWeek: ${weekNo}\nReason: Safety flag triggered in generated content.\nPlease review before sending.`;
  try {
    await wa.sendTemplate(MADDY_PHONE, 'escalation_alert', [alert], 'Maddy');
  } catch (err) {
    console.error('Review notification failed:', err.message);
  }
}
