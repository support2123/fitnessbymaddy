const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, PROGRAM_META } = require('../lib/utils');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'sarms', 'steroids',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .maybeSingle();

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('workout_plan,nutrition_plan,notes,week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const clientProfile = {
      name: client.name,
      program: client.program,
      programMeta: PROGRAM_META[client.program],
      weekNumber: week_no,
      intake: intakeForm || {},
      recentCheckins: recentCheckins || [],
      previousProgram: prevPrograms?.[0] || null,
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's AI program architect for FitnessByMaddy. You create personalized weekly workout and nutrition plans.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, steroids, or unregulated supplements
- Never promise specific weight loss timelines (e.g., "lose 10kg in 2 weeks")
- Progressive overload: increase volume/intensity by 5-10% per week max
- Account for injuries, medical conditions, and experience level
- For PCOS clients: focus on insulin-sensitizing nutrition, strength training, stress management
- For 40+ clients: prioritize joint-friendly movements, adequate protein (1.6-2g/kg), recovery
- Include warm-up and cool-down in every workout
- Nutrition must be practical and culturally appropriate (Indian diet for IN market clients)

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Strength",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 130,
    "carbs_g": 200,
    "fats_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "weekly_notes": "..."
  },
  "context_note": "One-liner summary for WhatsApp message"
}`;

    const userPrompt = `Create Week ${week_no} program for this client:

${JSON.stringify(clientProfile, null, 2)}

Based on their check-in data, adjust intensity and nutrition accordingly. If this is Week 1, create a baseline program from their intake form data.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await notifyMaddy('Program generation failed', `Could not parse JSON for ${maskPhone(client.phone)} Week ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const program = JSON.parse(jsonMatch[0]);

    const contentLower = JSON.stringify(program).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => contentLower.includes(flag));

    if (flagged) {
      await notifyMaddy(
        'Program flagged for review',
        `Week ${week_no} for ${maskPhone(client.phone)} contains risky content. Review before sending.`
      );

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: `FLAGGED: ${program.context_note || 'Needs Maddy review'}`,
      });

      return res.json({ success: true, flagged: true, message: 'Program flagged for manual review' });
    }

    const { data: savedProgram } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.context_note || '',
    }).select().single();

    const pdfContent = generateProgramText(program, client, week_no);
    const pdfPath = `clients/${client_id}/week_${week_no}.txt`;

    await supabase.storage.from('programs').upload(pdfPath, pdfContent, {
      contentType: 'text/plain',
      upsert: true,
    });

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    if (urlData?.publicUrl) {
      await supabase.from('programs').update({ pdf_url: urlData.publicUrl }).eq('id', savedProgram.id);
    }

    const contextNote = program.context_note || `Week ${week_no} program is ready!`;
    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      contextNote,
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', savedProgram.id);

    return res.json({ success: true, program_id: savedProgram.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generateProgramText(program, client, weekNo) {
  const lines = [];
  lines.push(`═══════════════════════════════════════`);
  lines.push(`  FITNESSBYMADDY — Week ${weekNo} Program`);
  lines.push(`  Client: ${client.name || 'Client'}`);
  lines.push(`  Program: ${PROGRAM_META[client.program]?.name || client.program}`);
  lines.push(`═══════════════════════════════════════\n`);

  if (program.workout_plan?.days) {
    lines.push(`── WORKOUT PLAN ──\n`);
    for (const day of program.workout_plan.days) {
      lines.push(`${day.day.toUpperCase()} — ${day.focus}`);
      if (day.warmup) lines.push(`  Warm-up: ${day.warmup}`);
      for (const ex of day.exercises || []) {
        lines.push(`  • ${ex.name}: ${ex.sets}×${ex.reps} (Rest: ${ex.rest})${ex.notes ? ' — ' + ex.notes : ''}`);
      }
      if (day.cooldown) lines.push(`  Cool-down: ${day.cooldown}`);
      lines.push('');
    }
    if (program.workout_plan.weekly_notes) {
      lines.push(`Notes: ${program.workout_plan.weekly_notes}\n`);
    }
  }

  if (program.nutrition_plan) {
    const np = program.nutrition_plan;
    lines.push(`── NUTRITION PLAN ──\n`);
    lines.push(`Daily Target: ${np.daily_calories} kcal | P: ${np.protein_g}g | C: ${np.carbs_g}g | F: ${np.fats_g}g\n`);
    for (const meal of np.meals || []) {
      lines.push(`${meal.meal}:`);
      for (const opt of meal.options || []) {
        lines.push(`  • ${opt}`);
      }
    }
    if (np.supplements?.length) {
      lines.push(`\nSupplements: ${np.supplements.join(', ')}`);
    }
    if (np.hydration) lines.push(`Hydration: ${np.hydration}`);
    if (np.weekly_notes) lines.push(`\nNotes: ${np.weekly_notes}`);
  }

  lines.push(`\n═══════════════════════════════════════`);
  lines.push(`  Stay consistent. Trust the process.`);
  lines.push(`  — Maddy`);
  lines.push(`═══════════════════════════════════════`);

  return lines.join('\n');
}
