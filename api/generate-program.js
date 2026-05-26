const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'below 800 cal',
  'banned substance', 'steroid', 'sarm', 'clenbuterol',
  'lose 10kg in', 'lose 20 pounds in a week',
  'starvation', 'water fast', 'dnp'
];

function hasSafetyIssues(text) {
  const lower = (typeof text === 'string' ? text : JSON.stringify(text)).toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Fetch client profile
    const { data: client } = await supabase
      .from('clients')
      .select('*, leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Fetch intake data
    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Fetch last 2 check-ins
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Fetch previous program for continuity
    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    // Build Claude prompt
    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      startDate: client.program_started_at,
      intake: intake ? {
        age: intake.age,
        gender: intake.gender,
        goal: intake.goal,
        injuries: intake.injuries,
        medicalConditions: intake.medical_conditions,
        dietPreference: intake.diet_preference,
        trainingExperience: intake.training_experience,
        schedule: intake.schedule_preference,
        currentWeight: intake.current_weight,
        targetWeight: intake.target_weight
      } : null,
      recentCheckins: (recentCheckins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues
      })),
      previousPlan: prevProgram ? {
        workout: prevProgram.workout_plan,
        nutrition: prevProgram.nutrition_plan,
        notes: prevProgram.notes
      } : null
    };

    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are a NASM-certified fitness coach creating a weekly program for a client.

CLIENT DATA:
${JSON.stringify(clientProfile, null, 2)}

Generate Week ${week_no} program as JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Push",
        "name": "Upper Body Push",
        "exercises": [
          { "name": "Exercise", "sets": "4", "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "notes": ""
      }
    ],
    "weekly_notes": ""
  },
  "nutrition_plan": {
    "overview": { "calories": "2200", "protein": "180g", "carbs": "220g", "fats": "73g" },
    "meals": [
      { "name": "Meal 1 - Breakfast", "time": "8:00 AM", "options": ["Option A", "Option B"], "description": "" }
    ],
    "supplements": [],
    "hydration": ""
  },
  "coach_notes": "Brief context note for this week"
}

RULES:
- Progressive overload from previous week if data available
- Adjust based on check-in feedback (energy, compliance, issues)
- Respect injuries and medical conditions
- Be realistic with calorie targets (never below 1200 for women, 1500 for men)
- Include rest days
- Diet should respect preferences (vegetarian, vegan, halal, etc.)
- 4-6 training days depending on experience level
- Output ONLY valid JSON, no markdown`
      }]
    });

    const rawOutput = response.content[0].text;

    // Parse the JSON response
    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    // Safety check
    if (hasSafetyIssues(parsed)) {
      console.error(`SAFETY FLAG: Program for ${maskPhone(client.phone)} W${week_no} contains risky content`);

      const { notifyMaddy } = require('../lib/escalation');
      await notifyMaddy(
        client.phone,
        `Auto-generated program for W${week_no} flagged for safety review. Contains potentially risky recommendations.`,
        'Risky program content'
      );

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan || {},
        nutrition_plan: parsed.nutrition_plan || {},
        notes: `FLAGGED FOR REVIEW: ${parsed.coach_notes || ''}`,
        generated_at: new Date().toISOString()
      });

      return res.status(200).json({ ok: true, flagged: true });
    }

    // Generate PDF
    const pdfUrl = await generateProgramPDF(
      client_id,
      week_no,
      parsed.workout_plan,
      parsed.nutrition_plan,
      parsed.coach_notes
    );

    // Save to programs table (audit trail BEFORE sending)
    const { data: program, error: progError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan || {},
        nutrition_plan: parsed.nutrition_plan || {},
        notes: parsed.coach_notes || '',
        pdf_url: pdfUrl,
        generated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (progError) {
      console.error('Program save error:', progError);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    // Send via WhatsApp
    const contextNote = parsed.coach_notes || `Your Week ${week_no} program is ready!`;
    const sendResult = await sendTemplate(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(week_no), contextNote],
      client.name
    );

    if (sendResult.ok) {
      await supabase.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    console.log(`Program generated: ${maskPhone(client.phone)} W${week_no}`);
    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
