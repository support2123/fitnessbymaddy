const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./lib/supabase');
const { generateProgramPDF } = require('./lib/pdf');
const { sendTemplate, sendToMaddy } = require('./lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('./lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'below 800 calories', 'starvation',
  'clenbuterol', 'dnp', 'steroids', 'anabolic', 'sarm',
  'lose 10kg in 1 week', 'extreme cut', 'water fast',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    const intakeInfo = lead?.first_msg?.includes('INTAKE')
      ? lead.first_msg.split('---INTAKE---')[1] || ''
      : '';

    const anthropic = new Anthropic();

    const systemPrompt = `You are a world-class fitness coach and program architect for Fitness by Maddy.
You design weekly workout and nutrition plans that are:
- Science-backed and progressive
- Tailored to the client's data, goals, and recent check-in feedback
- Safe and sustainable (NEVER recommend extreme calorie deficits below 1200 kcal, banned substances, or unrealistic timelines)
- Warm and motivating in tone

Output ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 — Push (Chest, Shoulders, Triceps)",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ],
        "notes": "Optional coach note for this day"
      }
    ]
  },
  "nutrition": {
    "calories": 2100,
    "macros": { "protein": 160, "carbs": 220, "fats": 65 },
    "meals": [
      { "name": "Meal 1 — Breakfast", "description": "Oats with protein powder and banana", "options": ["Alt: Egg whites with toast"] }
    ]
  },
  "coach_note": "A short motivational or instructional note for the client this week."
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'N/A'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intakeInfo ? `- Intake data: ${intakeInfo}` : ''}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10${c.issues ? `, Issues: ${c.issues}` : ''}`).join('\n')}` : 'No previous check-ins yet (Week 1).'}

Design a progressive, safe, and effective program for Week ${week_no}.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await sendToMaddy(`PROGRAM GEN FAILED [${maskPhone(client.phone)}]: Could not parse JSON from Claude response`);
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const program = JSON.parse(jsonMatch[0]);

    const flagged = checkSafetyFlags(rawText);
    if (flagged) {
      await sendToMaddy(
        `SAFETY FLAG [${maskPhone(client.phone)}] Week ${week_no}: "${flagged}" — program held for review`
      );
      return res.json({ success: false, reason: 'safety_flagged', flag: flagged });
    }

    const pdfBuffer = await generateProgramPDF(
      client, week_no,
      program.workout, program.nutrition, program.coach_note
    );

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = supabase.storage.from('programs').getPublicUrl(pdfPath);

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: program.workout,
      nutrition_plan: program.nutrition,
      notes: program.coach_note,
    });

    const market = detectMarket(client.phone);
    const templateName = isHinglish(market) ? 'weekly_program_hi' : 'weekly_program_en';
    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      `${week_no}`,
      publicUrl?.publicUrl || 'Check your email for the PDF',
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ success: true, week_no, pdf_url: publicUrl?.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function checkSafetyFlags(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}
