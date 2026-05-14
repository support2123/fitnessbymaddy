const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { generateProgramPDF } = require('./_lib/pdf');
const { sendMediaMessage } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 1000 cal', '800 cal', '500 cal',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'extreme cut', 'water fast',
  'starvation', 'laxative'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const prompt = buildPrompt(client, intake, recentCheckins, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Program generation parse error' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    let flagged = false;
    let flaggedReason = '';
    for (const flag of SAFETY_FLAGS) {
      if (fullText.includes(flag)) {
        flagged = true;
        flaggedReason = `Safety flag: "${flag}" detected in program`;
        break;
      }
    }

    if (parsed.nutrition_plan?.calories && parsed.nutrition_plan.calories < 1200) {
      flagged = true;
      flaggedReason = `Calories too low: ${parsed.nutrition_plan.calories}`;
    }

    const pdfBuffer = await generateProgramPDF(
      client,
      week_no,
      parsed.workout_plan,
      parsed.nutrition_plan,
      parsed.notes
    );

    const fileName = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(fileName);

    const pdfUrl = publicUrl.publicUrl;

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes || '',
      flagged,
      flagged_reason: flaggedReason || null
    });

    if (flagged) {
      console.log(`FLAGGED program for ${maskPhone(client.phone)}: ${flaggedReason}`);
      const { createEscalation } = require('./_lib/escalation');
      await createEscalation(client.phone, flaggedReason, `Week ${week_no} program flagged`);
      return res.status(200).json({ ok: true, flagged: true, reason: flaggedReason });
    }

    const caption = `Week ${week_no} program ready! Check your new workout and nutrition plan. Let's crush it 💪`;
    await sendMediaMessage(client.phone, pdfUrl, caption);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    console.log(`Program sent: ${maskPhone(client.phone)} week ${week_no}`);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are Maddy's program architect — an expert fitness coach creating a personalized weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${intake?.age || 'unknown'}
- Gender: ${intake?.gender || 'unknown'}
- Height: ${intake?.height_cm || 'unknown'}cm
- Current Weight: ${intake?.weight_kg || checkins?.[0]?.weight || 'unknown'}kg
- Goal: ${intake?.goal || client.program}
- Injuries/Limitations: ${intake?.injuries || 'none reported'}
- Medical Conditions: ${intake?.medical_conditions || 'none reported'}
- Diet Preference: ${intake?.diet_pref || 'no preference'}
- Meals per day: ${intake?.meals_per_day || 3}
- Workout Experience: ${intake?.workout_experience || 'intermediate'}
- Days per week: ${intake?.days_per_week || 5}
- Equipment: ${intake?.equipment_access || 'full gym'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

WEEK: ${weekNo} of 12

INSTRUCTIONS:
1. Create a progressive, science-based program for this specific week
2. Adjust based on check-in data (compliance, energy, issues)
3. NEVER prescribe below 1200 calories for women or 1500 for men
4. NEVER recommend any banned substances or extreme protocols
5. Include proper warm-up and cooldown guidance
6. Be specific with exercise names, sets, reps, and rest periods

Return ONLY valid JSON in this exact format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fats": 70,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "4 egg whites + 1 whole egg scrambled with spinach, 1 cup oats with berries" }
    ]
  },
  "notes": "Coach notes for the client about this week's focus"
}
\`\`\``;
}
