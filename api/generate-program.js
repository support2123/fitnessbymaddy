const { supabase } = require('../lib/supabase');
const { sendDocument } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');
const { generatePDF } = require('../lib/pdf-generator');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'extreme calorie', 'less than 1000 calories', 'under 800',
  'banned substance', 'steroid', 'sarm', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'crash diet', 'water fast'
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers['x-internal-key'];
  if (auth !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, lead:leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are the program architect for FitnessByMaddy, an elite online coaching brand.
Generate a weekly workout and nutrition plan based on the client data provided.

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "split": "PPL / Upper-Lower / Full Body",
    "days": [
      {
        "day": "Monday",
        "focus": "Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + dynamic stretches",
        "cooldown": "5 min static stretches"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "options": ["Option A", "Option B"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "coach_note": "One sentence context for the client about this week's focus."
}

RULES:
- Never prescribe fewer than 1200 calories for women or 1500 for men
- No banned substances, SARMs, or dangerous supplements
- Progressive overload from previous week if data available
- Adjust based on compliance score and energy levels from check-ins
- Be specific with exercise names, sets, reps, and rest times
- Include both veg and non-veg meal options when diet preference is mixed`;

    const userPrompt = `CLIENT PROFILE:
Name: ${client.name}
Program: ${client.program}
Week: ${week_no} of 12

INTAKE DATA:
${intake ? JSON.stringify({
  age: intake.age,
  gender: intake.gender,
  height: intake.height_cm,
  weight: intake.weight_kg,
  goal: intake.goal,
  injuries: intake.injuries,
  diet: intake.diet_preference,
  days_available: intake.workout_days,
  equipment: intake.equipment_access,
  stress: intake.stress_level
}, null, 2) : 'No intake form submitted yet — use defaults for a general fat loss / muscle building program.'}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0 ? JSON.stringify(recentCheckins.map(c => ({
  week: c.week_no,
  weight: c.weight,
  waist: c.waist,
  compliance: c.compliance_score,
  energy: c.energy,
  issues: c.issues
})), null, 2) : 'No check-ins yet (this is Week 1).'}

PREVIOUS WEEK PROGRAM:
${lastProgram ? JSON.stringify({
  workout: lastProgram.workout_plan,
  nutrition: lastProgram.nutrition_plan,
  notes: lastProgram.notes
}, null, 2) : 'No previous program (this is Week 1).'}

Generate Week ${week_no} program now.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssue(responseText)) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation(
        client.phone,
        'Program generation flagged for safety review',
        `Week ${week_no} — AI output contained safety flags`,
        client.id
      );
      return res.status(200).json({ flagged: true, reason: 'Safety review required' });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const filePath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: publicUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { error: dbError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl.publicUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null
    });

    if (dbError) throw dbError;

    const market = detectMarket(client.phone);
    const caption = isHinglish(market)
      ? `🔥 Week ${week_no} ka program ready hai! ${parsed.coach_note || ''}`
      : `🔥 Your Week ${week_no} program is ready! ${parsed.coach_note || ''}`;

    await sendDocument(client.phone, publicUrl.publicUrl, caption);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: publicUrl.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
