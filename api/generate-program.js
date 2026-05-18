const { getSupabase } = require('./lib/supabase');
const { sendTemplateForced } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/pii');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 calories', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'crash diet', 'water fast'
];

function auditProgramSafety(workout, nutrition) {
  const combined = JSON.stringify({ workout, nutrition }).toLowerCase();
  return SAFETY_FLAGS.filter(flag => combined.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
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

    const { data: prevProgram } = await db
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      try { intakeData = JSON.parse(lead?.first_msg || '{}'); } catch {}
    }

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram?.[0] || null, intakeData, week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text || '';

    let workoutPlan, nutritionPlan, notes;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        workoutPlan = parsed.workout_plan || parsed.workout;
        nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
        notes = parsed.notes || parsed.coach_notes || '';
      }
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const safetyIssues = auditProgramSafety(workoutPlan, nutritionPlan);
    if (safetyIssues.length > 0) {
      const { notifyMaddy } = require('./lib/escalation');
      await notifyMaddy(
        'Program safety flag',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}, Flags: ${safetyIssues.join(', ')}`
      );
      return res.status(200).json({
        ok: false,
        reason: 'safety_flagged',
        flags: safetyIssues
      });
    }

    const pdfUrl = `${client.folder_url}/week_${week_no}.pdf`;

    const { error: progErr } = await db.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }, { onConflict: 'client_id,week_no' });

    if (progErr) {
      console.error('Program save error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplateForced(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        week_no.toString(),
        notes ? notes.slice(0, 100) : 'Your new week plan is ready!'
      ]
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    console.log(`Program generated: ${maskPhone(client.phone)}, week ${week_no}`);
    return res.status(200).json({ ok: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, checkins, prevProgram, intake, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are "program_architect" for FitnessByMaddy, a world-class online fitness coaching brand.

Generate a complete Week ${weekNo} program for this client. Return ONLY valid JSON.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${intake.goal || 'general fitness'}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Current weight: ${lastCheckin?.weight || intake.weight || 'unknown'}
- Injuries/conditions: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_preference || 'flexible'}
- Workout days available: ${intake.workout_days || 5}
- Equipment: ${client.program === '6wk_home' ? 'Bodyweight only / minimal' : 'Full gym'}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight}kg, Waist: ${lastCheckin.waist}cm
- Compliance: ${lastCheckin.compliance_score}/10, Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'none'}` : 'No check-in data yet (Week 1).'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight}kg, Waist: ${prevCheckin.waist}cm
- Compliance: ${prevCheckin.compliance_score}/10, Energy: ${prevCheckin.energy}/10` : ''}

${prevProgram ? `PREVIOUS PROGRAM FOCUS: ${prevProgram.notes || 'standard progression'}` : ''}

RULES:
- Minimum 1200 calories for women, 1500 for men
- No banned substances or extreme approaches
- Progressive overload from previous week if data available
- Include warm-up and cool-down
- Practical meal options (Indian food options if client is from India)

Return JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] },
      ...
    ],
    "warmup": "...",
    "cooldown": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] },
      ...
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-line coach note for this week's focus"
}`;
}
