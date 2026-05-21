const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 cal', 'under 1000', '800 cal', '500 cal',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme deficit', 'starvation',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(f => lower.includes(f));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .or(`lead_id.eq.${client.lead_id},client_id.eq.${client_id}`)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, notes, workout_plan, nutrition_plan')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified program architect for Fitness by Maddy, an elite online coaching brand. Create evidence-based, progressive workout and nutrition plans.

Rules:
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines (max 1kg/week fat loss, 0.5kg/week muscle gain)
- Base nutrition on body weight, activity level, and goals
- Progressive overload: increase volume/intensity week-over-week
- Include deload if week_no is a multiple of 4
- Always include rest days
- Account for injuries and medical conditions

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1",
        "name": "Upper Body Push",
        "focus": "Chest, Shoulders, Triceps",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "macros": { "protein": 150, "carbs": 200, "fat": 67 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "time": "8:00 AM", "items": ["3 eggs scrambled", "2 toast", "1 banana"] }
    ]
  },
  "notes": "Coach notes for this week..."
}`;

    const userPrompt = buildUserPrompt(client, intake, recentCheckins, prevPrograms, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssue(responseText)) {
      await escalateToMaddy({
        reason: 'Safety flag in generated program',
        phone: client.phone,
        details: `Week ${week_no}: AI output contains risky recommendation`,
      });
      return res.json({ action: 'flagged_for_review', week_no });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (parseErr) {
      console.error('JSON parse failed:', parseErr.message);
      return res.status(500).json({ error: 'ai_response_parse_error' });
    }

    const pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan: parsed.workout_plan,
      nutritionPlan: parsed.nutrition_plan,
      notes: parsed.notes,
    });

    const pdfPath = `${client.id}/week_${week_no}.pdf`;
    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program, error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
    }).select().single();

    if (progErr) throw progErr;

    const contextNote = parsed.notes
      ? parsed.notes.split('.')[0].slice(0, 120)
      : `Week ${week_no} program ready`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [client.name || 'there', week_no.toString(), contextNote],
      mediaUrl: pdfUrl,
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.json({
      action: 'program_generated',
      program_id: program.id,
      week_no,
      pdf_url: pdfUrl,
    });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function buildUserPrompt(client, intake, recentCheckins, prevPrograms, weekNo) {
  let prompt = `Create a Week ${weekNo} program for this client:\n\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Name: ${client.name || 'N/A'}\n`;

  if (intake) {
    prompt += `\nClient Profile:\n`;
    prompt += `Age: ${intake.age || 'N/A'}, Gender: ${intake.gender || 'N/A'}\n`;
    prompt += `Height: ${intake.height_cm || 'N/A'}cm, Weight: ${intake.weight_kg || 'N/A'}kg\n`;
    prompt += `Goal: ${intake.goal || 'N/A'}\n`;
    prompt += `Injuries: ${intake.injuries || 'None'}\n`;
    prompt += `Medical: ${intake.medical_conditions || 'None'}\n`;
    prompt += `Diet: ${intake.diet_preference || 'No preference'}\n`;
    prompt += `Training days/week: ${intake.workout_days_per_week || 5}\n`;
    prompt += `Gym access: ${intake.gym_access ? 'Yes' : 'No'}\n`;
    if (intake.equipment_available) prompt += `Equipment: ${intake.equipment_available}\n`;
    prompt += `Stress level: ${intake.stress_level || 'N/A'}/10\n`;
  }

  if (recentCheckins && recentCheckins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const ci of recentCheckins) {
      prompt += `Week ${ci.week_no}: Weight ${ci.weight || 'N/A'}kg, Waist ${ci.waist || 'N/A'}cm, `;
      prompt += `Compliance ${ci.compliance_score || 'N/A'}/10, Energy ${ci.energy || 'N/A'}/10\n`;
      if (ci.issues) prompt += `Issues: ${ci.issues}\n`;
      if (ci.next_week_focus) prompt += `Focus: ${ci.next_week_focus}\n`;
    }
  }

  if (prevPrograms && prevPrograms.length > 0) {
    prompt += `\nPrevious week notes: ${prevPrograms[0].notes || 'N/A'}\n`;
  }

  prompt += `\nGenerate the Week ${weekNo} program JSON now.`;
  return prompt;
}
