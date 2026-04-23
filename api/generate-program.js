const Anthropic = require('@anthropic-ai/sdk');
const { getClient } = require('../lib/supabase');
const { generateProgramPDF, uploadPDF } = require('../lib/pdf');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /steroids?\b/i,
  /anabolic/i,
  /crash\s*diet/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i
];

function isSafeProgram(plan) {
  const text = JSON.stringify(plan);
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getClient();

    const { data: client } = await db.from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins for context
    const { data: checkins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get intake form data
    const { data: intakeMsg } = await db.from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1);

    let intakeData = {};
    if (intakeMsg && intakeMsg[0]) {
      try { intakeData = JSON.parse(intakeMsg[0].body); } catch {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified program architect for FitnessByMaddy, an elite online coaching brand. Generate weekly workout and nutrition plans that are:
- Science-backed, progressive, and periodised
- Tailored to the client's profile, goals, and recent check-in data
- Safe and sustainable — NEVER recommend extreme calorie deficits (below 1400 kcal for women, 1600 for men), banned substances, or unrealistic timelines
- Include proper warm-up, cooldown, and rest day guidance

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "name": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fat": 70,
    "meals": [
      {
        "name": "Meal 1 — Breakfast",
        "time": "8:00 AM",
        "items": ["4 egg whites + 1 whole egg scramble", "1 cup oats with banana"]
      }
    ]
  },
  "notes": "Coach note for the client about focus areas this week."
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intakeData.goal ? `- Goal: ${intakeData.goal}` : ''}
${intakeData.experience_level ? `- Experience: ${intakeData.experience_level}` : ''}
${intakeData.injuries ? `- Injuries/limitations: ${intakeData.injuries}` : ''}
${intakeData.diet_preference ? `- Diet preference: ${intakeData.diet_preference}` : ''}
${intakeData.training_days ? `- Available training days: ${intakeData.training_days}` : ''}
${intakeData.current_weight ? `- Current weight: ${intakeData.current_weight}` : ''}
${intakeData.target_weight ? `- Target weight: ${intakeData.target_weight}` : ''}

RECENT CHECK-INS:
${checkins && checkins.length > 0
  ? checkins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')
  : 'No check-ins yet (first week)'}

Generate a progressive, periodised plan for Week ${week_no}. Adjust intensity based on check-in data.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    // Safety check
    if (!isSafeProgram(parsed)) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation({
        phone: client.phone,
        clientId: client_id,
        reason: 'Unsafe program content flagged by safety filter',
        messageBody: `Week ${week_no} program contained risky content`
      });
      return res.status(422).json({ error: 'Program flagged for safety review' });
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan: parsed.workout_plan,
      nutritionPlan: parsed.nutrition_plan,
      notes: parsed.notes
    });

    // Upload to Supabase Storage
    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    // Store in programs table
    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes
    });

    // Send via WhatsApp
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const msg = hinglish
      ? `💪 Week ${week_no} ka program ready hai!\n\n${parsed.notes || 'Is week pe focus rakh aur results dekh!'}\n\nPDF: ${pdfUrl}`
      : `💪 Your Week ${week_no} program is ready!\n\n${parsed.notes || 'Stay focused this week and watch the results!'}\n\nPDF: ${pdfUrl}`;

    await sendWhatsApp({ phone: client.phone, body: msg });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
