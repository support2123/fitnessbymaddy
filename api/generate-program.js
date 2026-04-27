const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF, uploadPDF } = require('../lib/pdf');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm|steroid/i,
  /lose\s*\d{2,}\s*kg.*week/i,
  /extreme\s*deficit/i,
];

function hasRiskyContent(text) {
  return RISKY_PATTERNS.some((p) => p.test(text));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sb = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Get client data
    const { data: client } = await sb
      .from('clients')
      .select('*, leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get intake form data
    const { data: intake } = await sb
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    // Get last 2 check-ins
    const { data: checkins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get previous program if any
    const { data: prevProgram } = await sb
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    // Build Claude prompt
    const clientProfile = {
      name: client.name,
      program: client.program,
      weekNumber: week_no,
      totalWeeks: client.program === '12wk' ? 12 : 6,
      goal: intake?.goal || client.leads?.program_interest || 'general fitness',
      age: intake?.age,
      gender: intake?.gender,
      injuries: intake?.injuries,
      medicalConditions: intake?.medical_conditions,
      dietPreference: intake?.diet_preference,
      workoutSchedule: intake?.workout_schedule,
      experienceLevel: intake?.experience_level,
    };

    const recentCheckins = (checkins || []).map((c) => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
    }));

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: `You are a certified fitness program architect for FitnessByMaddy. Generate a personalized weekly training and nutrition program.

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(recentCheckins, null, 2)}

${prevProgram ? `PREVIOUS WEEK PROGRAM:\n${JSON.stringify(prevProgram, null, 2)}` : 'This is the first week — create a foundational program.'}

RULES:
- Design for the client's specific goal, experience level, and any limitations
- If injuries/medical conditions exist, modify exercises accordingly
- Respect diet preferences
- Progressive overload from previous week if available
- 4-6 training days, 1-2 rest days
- Include warm-up and cool-down notes
- Nutrition: realistic calorie targets, minimum 1200 kcal for women, 1500 for men
- No extreme deficits, no banned substances, no unrealistic timelines
- If compliance was low last week, simplify slightly and add motivational note

Respond ONLY with valid JSON in this exact format:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 — Upper Body Push",
        "warmup": "5 min light cardio + dynamic stretches",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ],
        "cooldown": "5 min stretching"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein": 140,
    "carbs": 180,
    "fats": 60,
    "meals": [
      {
        "name": "Meal 1 — Breakfast",
        "items": ["3 eggs scrambled with spinach", "1 slice whole wheat toast", "Black coffee"]
      }
    ]
  },
  "notes": "Coach's note for the client about this week's focus"
}`,
        },
      ],
    });

    const rawText = response.content[0].text;

    // Check for risky content
    if (hasRiskyContent(rawText)) {
      console.error(`[PROGRAM] Risky content detected for ${maskPhone(client.phone)}`);

      const { createEscalation } = require('../lib/escalation');
      await createEscalation(
        client.phone,
        'risky_program_content',
        `Week ${week_no} program flagged for review`,
        client.id
      );

      await sb.from('programs').insert({
        client_id,
        week_no,
        workout_plan: { flagged: true },
        nutrition_plan: { flagged: true },
        notes: 'FLAGGED — risky content detected. Awaiting Maddy review.',
      });

      return res.status(200).json({ ok: true, flagged: true });
    }

    // Parse the JSON response
    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      console.error(`[PROGRAM] Failed to parse Claude response`);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const { workout_plan, nutrition_plan, notes } = parsed;

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(
      client.name || 'Client',
      week_no,
      workout_plan,
      nutrition_plan,
      notes
    );

    // Upload PDF
    const pdfUrl = await uploadPDF(client.id, week_no, pdfBuffer);

    // Save to programs table (audit trail)
    const { data: program } = await sb
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan,
        nutrition_plan,
        notes,
      })
      .select()
      .single();

    // Send via WhatsApp
    const contextNote = notes
      ? notes.slice(0, 200)
      : `Here's your Week ${week_no} program!`;

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(week_no), contextNote],
      media: { url: pdfUrl, filename: `week_${week_no}_program.pdf` },
    });

    // Update WhatsApp sent timestamp
    await sb
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`[PROGRAM] Generated week ${week_no} for ${maskPhone(client.phone)}`);

    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error(`[PROGRAM] Error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
