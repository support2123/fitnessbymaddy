const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendWhatsAppMessage } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { maskPhone } = require('../lib/market');

const RISKY_PATTERNS = [
  /below\s*\d{3}\s*cal/i,
  /under\s*800\s*cal/i,
  /500\s*cal.*diet/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedrine/i,
  /sarm/i,
  /steroid/i,
  /anabolic/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: lastProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(client, week_no, recentCheckins, lastProgram);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch (parseErr) {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { workout_plan, nutrition_plan, notes } = parsed;

    const fullText = JSON.stringify(parsed);
    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(fullText)) {
        await notifyMaddyRisky(db, client, week_no, pattern.toString());
        return res.status(200).json({
          action: 'flagged_for_review',
          reason: 'Risky content detected: ' + pattern.toString()
        });
      }
    }

    const pdfUrl = await generateProgramPDF(client, week_no, workout_plan, nutrition_plan, notes);

    const { error: insertErr } = await db.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan,
      nutrition_plan,
      notes
    }, {
      onConflict: 'client_id,week_no'
    });

    if (insertErr) throw insertErr;

    const market = detectMarketFromPhone(client.phone);
    const hinglish = isHinglish(market);

    const contextNote = notes
      ? (hinglish
        ? `Week ${week_no} ka plan ready hai! ${notes.slice(0, 100)}`
        : `Your Week ${week_no} plan is ready! ${notes.slice(0, 100)}`)
      : (hinglish
        ? `Week ${week_no} ka plan ready hai! Check karo aur koi doubt ho toh batao.`
        : `Your Week ${week_no} plan is ready! Check it out and let us know if you have questions.`);

    await sendWhatsAppMessage(client.phone, `${contextNote}\n\nPDF: ${pdfUrl}`);

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

function buildSystemPrompt() {
  return `You are a NASM-certified fitness program architect for FitnessByMaddy.
You create personalised weekly workout and nutrition plans.

Rules:
- Base everything on science-backed training principles
- Never recommend extreme calorie deficits (below 1200 cal for women, 1500 for men)
- Never recommend banned substances, SARMs, steroids, or dangerous supplements
- Never promise unrealistic timelines (e.g., "lose 10kg in a week")
- Account for client injuries, limitations, and preferences
- Progressive overload: each week should build on the previous
- Nutrition should be sustainable, not crash-diet style
- Include warm-up and cool-down in workout plans

Output format: Return a single JSON object with this structure:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "focus": "Chest, Shoulders, Triceps",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "note": "optional note" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fat": 67,
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": ["3 eggs scrambled", "2 toast whole wheat", "1 banana"]
      }
    ],
    "notes": "Additional nutrition guidance"
  },
  "notes": "Brief coaching note for the client this week (2-3 sentences)"
}`;
}

function buildUserPrompt(client, weekNo, checkins, lastProgram) {
  let prompt = `Create Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Goal: ${client.goal || 'General fitness'}\n`;

  if (client.age) prompt += `Age: ${client.age}\n`;
  if (client.injuries) prompt += `Injuries/Limitations: ${client.injuries}\n`;
  if (client.diet_pref) prompt += `Diet Preference: ${client.diet_pref}\n`;
  if (client.schedule) prompt += `Schedule: ${client.schedule}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const ci of checkins) {
      prompt += `- Week ${ci.week_no}: Weight ${ci.weight || 'N/A'}kg, Waist ${ci.waist || 'N/A'}cm, `;
      prompt += `Compliance ${ci.compliance_score || 'N/A'}/10, Energy ${ci.energy || 'N/A'}/10`;
      if (ci.issues) prompt += `, Issues: ${ci.issues}`;
      if (ci.next_week_focus) prompt += `, Focus: ${ci.next_week_focus}`;
      prompt += `\n`;
    }
  }

  if (lastProgram) {
    prompt += `\nLast week's program summary available for progressive overload planning.\n`;
  }

  if (weekNo === 1) {
    prompt += `\nThis is Week 1 — start with baseline assessment and moderate intensity.\n`;
  }

  return prompt;
}

function detectMarketFromPhone(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

async function notifyMaddyRisky(db, client, weekNo, pattern) {
  const MADDY_PHONE = '+917082478374';
  const msg = `PROGRAM SAFETY FLAG\n\nClient: ${maskPhone(client.phone)}\nWeek: ${weekNo}\nPattern: ${pattern}\n\nGenerated program has been HELD — not sent to client. Please review and approve manually.`;

  await db.from('messages').insert({
    phone: MADDY_PHONE, direction: 'out', body: msg, template_name: '_internal_escalation'
  });

  try {
    await sendWhatsAppMessage(MADDY_PHONE, msg, '_internal_escalation');
  } catch (e) {
    console.error('Failed to notify Maddy about risky program:', e.message);
  }
}
