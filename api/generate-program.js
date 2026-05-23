const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf-generator');
const { sendMediaMessage } = require('../lib/whatsapp');
const { createEscalation } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'below 1000', 'below 800',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10 kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for weight loss'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Get client profile
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get last 2 check-ins for context
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get lead data for intake info
    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();

      if (lead?.first_msg) {
        try { intakeData = JSON.parse(lead.first_msg); } catch (_) {}
      }
    }

    // Build the Claude prompt
    const prompt = buildProgramPrompt(client, checkins || [], intakeData, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0]?.text || '';

    // Safety check
    const lowerContent = content.toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (lowerContent.includes(flag)) {
        await createEscalation(
          client.phone,
          `Safety flag in generated program: "${flag}"`,
          `Week ${week_no} program contained flagged content. Halted auto-send.`
        );
        return res.status(200).json({ ok: false, reason: 'safety_flagged', flag });
      }
    }

    // Parse the JSON response
    let workoutPlan, nutritionPlan, notes;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
      workoutPlan = parsed.workout_plan || parsed.workoutPlan || {};
      nutritionPlan = parsed.nutrition_plan || parsed.nutritionPlan || {};
      notes = parsed.notes || parsed.coach_notes || '';
    } catch (_) {
      workoutPlan = { summary: content };
      nutritionPlan = {};
      notes = 'Auto-parsed from Claude response';
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(
      client.name || 'Client',
      week_no,
      workoutPlan,
      nutritionPlan,
      notes
    );

    // Upload to Supabase Storage
    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    // Get public URL
    const { data: urlData } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || '';

    // Save to programs table (audit trail first, before sending)
    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    });

    if (progErr) {
      console.error('Program insert error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    // Send via WhatsApp
    if (pdfUrl) {
      const caption = `Week ${week_no} program ready! ${notes ? notes.slice(0, 100) : 'Check your new plan.'}`;
      const sendResult = await sendMediaMessage(client.phone, pdfUrl, caption);

      if (sendResult.ok) {
        await db.from('programs').update({
          whatsapp_sent_at: new Date().toISOString()
        }).eq('client_id', client_id).eq('week_no', parseInt(week_no));
      }
    }

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, intake, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a NASM-certified personal trainer and nutrition coach creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Height: ${intake.height || 'unknown'}
- Current weight: ${intake.current_weight || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Injuries: ${intake.injuries || 'none reported'}
- Medical conditions: ${intake.medical_conditions || 'none reported'}
- Diet preference: ${intake.diet_preference || 'no preference'}
- Experience: ${intake.workout_experience || 'intermediate'}
- Equipment: ${intake.available_equipment || 'full gym'}
- Schedule: ${intake.weekly_schedule || '5 days/week'}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

TASK: Create Week ${weekNo} program. Return ONLY valid JSON:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ],
        "notes": "Focus on mind-muscle connection"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fats": 70,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "4 egg whites + 2 whole eggs, oats 50g, banana" }
    ]
  },
  "notes": "Brief coach note about this week's focus"
}

RULES:
- Never prescribe below 1200 kcal/day for women or 1500 for men
- No banned substances or supplements requiring medical supervision
- Progressive overload from previous weeks if check-in data available
- Adjust based on compliance score and energy levels
- Keep it practical and achievable
- If injuries listed, program around them with alternatives`;
}
