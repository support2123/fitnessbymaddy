const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { generateProgramPDF, uploadPDF } = require('../lib/pdf');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'starvation', 'under 1000 cal', 'under 800 cal',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Fetch last 2 check-ins for context
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Fetch intake data
    const { data: intakeMessages } = await supabase
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1);

    let intakeData = {};
    if (intakeMessages?.[0]?.body) {
      try { intakeData = JSON.parse(intakeMessages[0].body); } catch {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, steroids, SARMs, or any unregulated supplements
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Tailor to the client's experience level, injuries, and preferences
- Use progressive overload principles
- Include rest days and recovery protocols

OUTPUT FORMAT: Return valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 — Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ],
        "notes": "optional note"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fat": 70,
    "meals": [
      { "name": "Meal 1 — Breakfast", "items": ["4 egg whites + 1 whole egg", "1 cup oats"] }
    ]
  },
  "notes": "Coach notes for the client about this week's focus"
}`;

    const userPrompt = buildPrompt(client, intakeData, checkins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text;

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');

    const plan = JSON.parse(jsonMatch[0]);

    // Safety check
    const planStr = JSON.stringify(plan).toLowerCase();
    const flagged = SAFETY_FLAGS.filter(f => planStr.includes(f));
    if (flagged.length > 0) {
      await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', [
        maskPhone(client.phone),
        `SAFETY FLAG in Week ${week_no} program: ${flagged.join(', ')}`,
        'Auto-generation halted. Manual review required.',
      ]);
      return res.status(200).json({ ok: false, flagged, message: 'Flagged for review' });
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(
      client, week_no, plan.workout_plan, plan.nutrition_plan, plan.notes
    );
    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    // Save to programs table
    const { error: progError } = await supabase.from('programs').insert({
      client_id, week_no,
      pdf_url: pdfUrl,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.notes,
    });
    if (progError) throw progError;

    // Send via WhatsApp
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      pdfUrl,
    ]);

    // Update whatsapp_sent_at
    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    console.log(`Program generated: ${maskPhone(client.phone)} Week ${week_no}`);
    return res.status(200).json({ ok: true, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  let prompt = `Create Week ${weekNo} program for this client:\n\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Name: ${client.name || 'Unknown'}\n`;

  if (intake.age) prompt += `Age: ${intake.age}\n`;
  if (intake.goal) prompt += `Goal: ${intake.goal}\n`;
  if (intake.experience) prompt += `Experience: ${intake.experience}\n`;
  if (intake.injuries) prompt += `Injuries/Limitations: ${intake.injuries}\n`;
  if (intake.diet_pref) prompt += `Diet Preference: ${intake.diet_pref}\n`;
  if (intake.schedule) prompt += `Schedule: ${intake.schedule}\n`;

  if (checkins && checkins.length > 0) {
    prompt += '\nRecent Check-ins:\n';
    for (const ci of checkins) {
      prompt += `  Week ${ci.week_no}: Weight ${ci.weight || '?'}kg, Waist ${ci.waist || '?'}cm, `;
      prompt += `Compliance ${ci.compliance_score || '?'}/10, Energy ${ci.energy || '?'}/10`;
      if (ci.issues) prompt += `, Issues: ${ci.issues}`;
      if (ci.next_week_focus) prompt += `, Focus: ${ci.next_week_focus}`;
      prompt += '\n';
    }
  }

  if (weekNo > 1) {
    prompt += `\nThis is Week ${weekNo} — apply progressive overload from last week. `;
    prompt += 'Adjust based on compliance and energy scores.\n';
  }

  return prompt;
}
