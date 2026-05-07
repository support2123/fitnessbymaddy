const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { generateProgramPDF, formatProgramName } = require('./_lib/pdf');
const { sendClientMessage } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'sarms', 'steroid', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'crash diet', 'water fast for'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Design safe, science-backed workout and nutrition plans.
NEVER recommend: extreme calorie restriction below 1200kcal for women / 1500kcal for men,
banned substances, unrealistic timelines, or anything that could harm the client.
Output ONLY valid JSON matching the schema provided.`;

    const userPrompt = buildPrompt(client, week_no, recentCheckins, prevProgram);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0]?.text || '';

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy('Program generation failed — no valid JSON', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program generation returned invalid output`
      });
      return res.status(500).json({ error: 'Invalid AI response format' });
    }

    const plan = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(plan).toLowerCase();
    const hasSafetyIssue = SAFETY_FLAGS.some(flag => fullText.includes(flag));

    if (hasSafetyIssue) {
      await escalateToMaddy('Safety flag in generated program', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program flagged for safety review before sending`
      });

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: plan.workout || null,
        nutrition_plan: plan.nutrition || null,
        notes: 'FLAGGED FOR SAFETY REVIEW — not auto-sent',
        pdf_url: null,
        whatsapp_sent_at: null
      });

      return res.status(200).json({ ok: true, action: 'flagged_for_review' });
    }

    const pdfBuffer = await generateProgramPDF(
      client, week_no,
      plan.workout, plan.nutrition, plan.notes
    );

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = db.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || null;

    await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: plan.workout || null,
      nutrition_plan: plan.nutrition || null,
      notes: plan.notes || null,
      pdf_url: pdfUrl
    });

    await sendClientMessage(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      plan.notes || 'Your new program is ready!'
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      ok: true,
      action: 'program_generated',
      week_no,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, weekNo, checkins, prevProgram) {
  let prompt = `Generate a Week ${weekNo} fitness program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${formatProgramName(client.program)}
- Status: ${client.status}

`;

  if (checkins && checkins.length > 0) {
    prompt += 'RECENT CHECK-INS:\n';
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    }
    prompt += '\n';
  }

  if (prevProgram) {
    prompt += 'PREVIOUS WEEK PLAN SUMMARY:\n';
    prompt += `Workout: ${JSON.stringify(prevProgram.workout_plan || {}).slice(0, 500)}\n`;
    prompt += `Nutrition: ${JSON.stringify(prevProgram.nutrition_plan || {}).slice(0, 500)}\n\n`;
  }

  prompt += `OUTPUT FORMAT — respond with ONLY this JSON:
{
  "workout": {
    "days": [
      {
        "day": "Day 1 — Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "control eccentric" }
        ],
        "notes": "optional day note"
      }
    ]
  },
  "nutrition": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 65 },
    "meals": [
      {
        "name": "Meal 1 — Breakfast",
        "items": ["4 egg whites + 1 whole egg", "1 cup oats"],
        "notes": "optional"
      }
    ]
  },
  "notes": "1-2 sentence personalised note to the client for this week"
}`;

  return prompt;
}
