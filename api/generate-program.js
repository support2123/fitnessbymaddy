const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendClientMessage, notifyMaddy } = require('../lib/whatsapp');

const UNSAFE_PATTERNS = [
  /below\s*\d{3,4}\s*cal/i,
  /under\s*800\s*cal/i,
  /starvation/i,
  /dnp/i,
  /clenbuterol/i,
  /ephedra/i,
  /anabolic/i,
  /steroid/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*(in|per)\s*(a\s*)?week/i,
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    // Load client data
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Load last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Load intake data from lead
    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      if (lead?.first_msg) {
        try { intakeData = JSON.parse(lead.first_msg); } catch (_) {}
      }
    }

    // Build Claude prompt
    const prompt = buildPrompt(client, intakeData, checkins || [], week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;

    // Safety check
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(responseText)) {
        await notifyMaddy(
          'Program Safety Flag',
          `Client: ${client.name} | Week ${week_no} | Flagged content detected — manual review needed.`
        );
        await supabase.from('programs').insert({
          client_id,
          week_no,
          notes: 'FLAGGED FOR REVIEW: ' + responseText.slice(0, 500),
        });
        return res.status(200).json({ ok: false, reason: 'safety_flagged' });
      }
    }

    // Parse the response
    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = extractJSON(responseText);
      workoutPlan = parsed.workout_plan;
      nutritionPlan = parsed.nutrition_plan;
      notes = parsed.coach_notes || parsed.notes || '';
    } catch (_) {
      workoutPlan = { days: [] };
      nutritionPlan = {};
      notes = responseText;
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(client, week_no, workoutPlan, nutritionPlan, notes);

    // Upload to Supabase Storage
    const pdfPath = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Save to programs table
    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes,
      })
      .select()
      .single();

    // Send via WhatsApp
    await sendClientMessage(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(week_no), pdfUrl],
      client.name
    );

    // Update program with send timestamp
    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      ok: true,
      program_id: program.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const recentCheckins = checkins.map(c => `
    Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm,
    Compliance ${c.compliance_score}/10, Energy ${c.energy}/10
    Issues: ${c.issues || 'None'}
  `).join('\n');

  return `You are an expert fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
${intake.age ? `- Age: ${intake.age}` : ''}
${intake.gender ? `- Gender: ${intake.gender}` : ''}
${intake.goal ? `- Goal: ${intake.goal}` : ''}
${intake.experience ? `- Experience: ${intake.experience}` : ''}
${intake.injuries ? `- Injuries/Limitations: ${intake.injuries}` : ''}
${intake.diet_pref ? `- Diet Preference: ${intake.diet_pref}` : ''}
${intake.current_weight ? `- Current Weight: ${intake.current_weight}kg` : ''}
${intake.target_weight ? `- Target Weight: ${intake.target_weight}kg` : ''}
${intake.schedule ? `- Schedule: ${intake.schedule}` : ''}
${intake.medical_conditions ? `- Medical Conditions: ${intake.medical_conditions}` : ''}

RECENT CHECK-INS:
${recentCheckins || 'No previous check-ins (first week)'}

RULES:
- Create a safe, evidence-based program
- Never prescribe extreme calorie restriction (minimum 1200kcal women, 1500kcal men)
- Never recommend banned substances or supplements
- Set realistic expectations (0.5-1kg/week loss max)
- If injuries are mentioned, provide modifications
- Progressive overload from previous weeks when check-in data available

Respond with ONLY valid JSON in this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1",
        "name": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ],
        "notes": "Optional day-specific notes"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fats": 70,
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["Oats 50g", "Banana 1", "Whey 1 scoop"] }
    ],
    "notes": "Optional nutrition notes"
  },
  "coach_notes": "Brief motivational or instructional note for the week"
}`;
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found');
  return JSON.parse(match[0]);
}
