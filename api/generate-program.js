const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { programLabel, corsHeaders } = require('./_lib/utils');

const UNSAFE_PATTERNS = [
  /below\s*800\s*cal/i,
  /under\s*1[,.]?000\s*cal/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /anabolic/i,
  /steroid/i,
  /lose\s*\d+\s*kg.*in\s*(1|2|3)\s*days?/i,
];

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
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

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const programData = await callClaudeForProgram(client, recentCheckins || [], week_no);

    if (!programData) {
      return res.status(500).json({ error: 'Program generation failed' });
    }

    if (programData.flagged) {
      await sendWhatsApp({
        phone: process.env.MADDY_PHONE || '+917082478374',
        templateName: 'escalation_alert',
        bodyValues: [
          client.name || 'Unknown',
          'Unsafe program content detected - needs manual review',
          `Week ${week_no} program for ${programLabel(client.program)}`,
        ],
      });

      return res.json({
        ok: false,
        flagged: true,
        message: 'Program flagged for manual review',
      });
    }

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.notes,
      pdf_url: null,
    });

    if (insertErr) {
      console.error('[GenProg] Insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [
        client.name || 'there',
        String(week_no),
        programData.notes || 'New week, new gains!',
      ],
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ ok: true, week_no, client_id });
  } catch (err) {
    console.error('[GenProg] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function callClaudeForProgram(client, checkins, weekNo) {
  if (!process.env.CLAUDE_API_KEY) {
    console.error('[GenProg] CLAUDE_API_KEY not configured');
    return null;
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const checkinSummary = checkins.map(c => (
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, ` +
    `compliance=${c.compliance_score}/10, energy=${c.energy}/10, ` +
    `issues: ${c.issues || 'none'}`
  )).join('\n');

  const prompt = `You are a certified personal trainer and nutritionist creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${programLabel(client.program)}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No check-in data yet (first week)'}

Create a detailed weekly program. Return ONLY valid JSON with this structure:
{
  "workout": {
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
    "rest_days": ["Sunday"]
  },
  "nutrition": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "notes": "One-liner motivation or focus for this week"
}

RULES:
- Be progressive: increase intensity/volume based on check-in data
- Never prescribe extreme calorie deficits (minimum 1200 cal women, 1500 cal men)
- Never recommend banned substances or steroids
- If compliance was low, simplify the plan
- If energy was low, reduce volume slightly and check nutrition
- Keep it practical and achievable`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[GenProg] No JSON in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = UNSAFE_PATTERNS.some(p => p.test(fullText));

    return {
      workout: parsed.workout || null,
      nutrition: parsed.nutrition || null,
      notes: parsed.notes || '',
      flagged,
    };
  } catch (err) {
    console.error('[GenProg] Claude API error:', err.message);
    return null;
  }
}
