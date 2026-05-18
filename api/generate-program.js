const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { buildPDF, uploadPDF } = require('../lib/pdf');
const { sendMediaMessage } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');
const { maskPhone, isHinglish, detectMarket } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme cut', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'sarms', 'steroids', 'anavar',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function isSafe(plan) {
  const text = JSON.stringify(plan).toLowerCase();
  return !SAFETY_FLAGS.some(flag => text.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Fetch last 2 check-ins for context
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Fetch intake data from messages
    const { data: intakeMsgs } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('direction', 'in')
      .like('body', '%intake_form%')
      .limit(1);

    let intakeData = {};
    if (intakeMsgs?.length > 0) {
      try { intakeData = JSON.parse(intakeMsgs[0].body); } catch {}
    }

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    // Build Claude prompt
    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances, SARMs, or steroids
- Be realistic: max 0.5-1kg fat loss per week is healthy
- Consider injuries, medical conditions, and experience level
- If client is PCOS: prioritize strength training, anti-inflammatory nutrition
- If client is 40+: prioritize joint-friendly exercises, adequate protein
- Output valid JSON only. No markdown fences.`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${intakeData.goal || 'fat loss and fitness'}
- Age: ${intakeData.age || 'unknown'}
- Gender: ${intakeData.gender || 'unknown'}
- Experience: ${intakeData.experience_level || 'intermediate'}
- Injuries: ${intakeData.injuries || 'none reported'}
- Diet preference: ${intakeData.diet_pref || 'no restrictions'}
- Schedule: ${intakeData.schedule || '5 days/week'}
- Medical: ${intakeData.medical_conditions || 'none'}

RECENT CHECK-INS:
${recentCheckins?.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n') || 'No previous check-ins (Week 1)'}

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "focus": "Chest, Shoulders, Triceps",
        "exercises": [
          { "name": "Bench Press", "sets": "4x8-10", "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein": 140,
    "carbs": 180,
    "fats": 60,
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["4 egg whites + 1 whole egg scrambled", "1 cup oats with berries"] }
    ]
  },
  "notes": "Brief coach note about this week's focus and adjustments."
}`;

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    let planText = response.content[0].text;
    // Strip markdown fences if present
    planText = planText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let plan;
    try {
      plan = JSON.parse(planText);
    } catch {
      console.error(`Invalid JSON from Claude for ${maskPhone(client.phone)} week ${week_no}`);
      await notifyMaddy('Program generation returned invalid JSON', { phone: client.phone, name: client.name });
      return res.status(500).json({ error: 'Invalid program output' });
    }

    // Safety check
    if (!isSafe(plan)) {
      await notifyMaddy('Program flagged for safety review', { phone: client.phone, name: client.name });
      await db.from('programs').insert({
        client_id, week_no: parseInt(week_no),
        workout_plan: plan.workout_plan,
        nutrition_plan: plan.nutrition_plan,
        notes: '[FLAGGED FOR REVIEW] ' + (plan.notes || '')
      });
      return res.json({ action: 'flagged_for_review', client_id, week_no });
    }

    // Generate PDF
    const pdfBuffer = await buildPDF(
      client, week_no,
      plan.workout_plan, plan.nutrition_plan, plan.notes
    );

    // Upload to Supabase Storage
    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    // Store in programs table
    await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.notes,
      pdf_url: pdfUrl,
      generated_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' });

    // Send via WhatsApp
    const contextNote = hinglish
      ? `Week ${week_no} program ready hai! Check karo aur koi doubt ho toh batao.`
      : `Your Week ${week_no} program is ready! Review it and let me know if you have questions.`;

    const sendResult = await sendMediaMessage(client.phone, pdfUrl, contextNote);

    if (sendResult.ok) {
      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('client_id', client_id).eq('week_no', parseInt(week_no));
    }

    return res.json({ action: 'generated', client_id, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
