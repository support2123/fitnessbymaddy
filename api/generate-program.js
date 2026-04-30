const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendText, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'under 800', 'under 1000',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const { data: intakeData } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form_submission')
      .order('sent_at', { ascending: false })
      .limit(1);

    let clientProfile = {};
    if (intakeData && intakeData.length > 0) {
      try { clientProfile = JSON.parse(intakeData[0].body); } catch {}
    }

    const prompt = buildProgramPrompt(client, clientProfile, recentCheckins || [], week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const aiText = response.content[0].text;

    if (hasSafetyIssue(aiText)) {
      const { sendText: sendAlert } = require('../lib/whatsapp');
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        phone: client.phone,
        reason: 'AI-generated program flagged for safety review',
        messageText: `Week ${week_no} program for ${client.name} contains potentially unsafe content. Manual review required.`,
      });
      return res.status(200).json({ flagged: true, message: 'Program flagged for Maddy review' });
    }

    let parsed;
    try {
      const jsonMatch = aiText.match(/```json\s*([\s\S]*?)```/) || aiText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : aiText;
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = { workout_plan: {}, nutrition_plan: {}, notes: aiText };
    }

    const workoutPlan = parsed.workout_plan || parsed.workouts || {};
    const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    const notes = parsed.notes || parsed.coach_notes || '';

    const pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan,
      nutritionPlan,
      notes,
    });

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client.id}/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    let pdfUrl = null;
    if (!uploadError) {
      const { data: urlData } = db.storage
        .from('programs')
        .getPublicUrl(storagePath);
      pdfUrl = urlData?.publicUrl || null;
    }

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
    }).select('id').single();

    if (pdfUrl) {
      const msg = `Your Week ${week_no} program is ready! Download here: ${pdfUrl}\n\nKey focus: ${notes ? notes.substring(0, 100) : 'Progressive overload and consistency.'}`;
      await sendText(client.phone, msg);
      await logMessage({
        phone: client.phone,
        direction: 'out',
        body: msg,
        templateName: 'program_delivery',
      });

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({
      success: true,
      programId: program.id,
      pdfUrl,
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, profile, checkins, weekNo) {
  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  return `You are Maddy's AI program architect for FitnessByMaddy. Generate a personalised weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Goal: ${profile.goal || 'body transformation'}
- Age: ${profile.age || 'unknown'}
- Gender: ${profile.gender || 'unknown'}
- Experience: ${profile.experience_level || 'intermediate'}
- Injuries: ${profile.injuries || 'none reported'}
- Diet preference: ${profile.diet_preference || 'no restrictions'}
- Schedule: ${profile.schedule || 'flexible'}
- Current weight: ${lastCheckin.weight || profile.current_weight || 'unknown'}
- Target weight: ${profile.target_weight || 'not specified'}

LAST CHECK-IN (Week ${lastCheckin.week_no || 'N/A'}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'none'}

PREVIOUS CHECK-IN (Week ${prevCheckin.week_no || 'N/A'}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10

RULES:
- Never recommend fewer than 1200 kcal/day for women or 1500 kcal/day for men
- Never recommend banned substances or steroids
- Set realistic expectations (0.5-1kg fat loss per week max)
- If injuries are reported, modify exercises accordingly
- Progressive overload from previous weeks

Return a JSON object with this exact structure:
{
  "workout_plan": {
    "Day 1 - Push": [
      {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s"},
      ...
    ],
    "Day 2 - Pull": [...],
    ...
    "Day 6 - Active Recovery": [...]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": {"protein": 180, "carbs": 220, "fat": 65},
    "meals": [
      {"name": "Meal 1 - Breakfast", "items": ["4 eggs scrambled", "2 toast", "1 banana"]},
      ...
    ]
  },
  "notes": "Brief coach note about this week's focus and adjustments"
}`;
}
