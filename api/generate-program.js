const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/phone');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'crash diet', 'water fast'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db.from('clients')
      .select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db.from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy, an elite online coaching service. You design weekly training and nutrition programs.

RULES:
- Programs must be safe, evidence-based, and progressive
- Never recommend calories under 1200 for women or 1500 for men
- Never recommend banned substances, steroids, SARMs, or any harmful supplements
- Progressive overload: increase volume or intensity by 2-5% per week
- Include rest days and deload guidance
- Nutrition must include adequate protein (1.6-2.2g/kg bodyweight)
- Be realistic about timelines (0.5-1kg fat loss per week max)

OUTPUT FORMAT: Return valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "..." }
    ]
  },
  "notes": "Coach notes for the week"
}`;

    const checkinSummary = recentCheckins && recentCheckins.length > 0
      ? recentCheckins.map(c =>
          `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues=${c.issues || 'none'}`
        ).join('\n')
      : 'No previous check-ins available.';

    const prevProgramSummary = lastProgram
      ? `Previous program: ${JSON.stringify(lastProgram.workout_plan || {}).slice(0, 500)}`
      : 'No previous program — this is Week 1.';

    const userPrompt = `Generate Week ${week_no} program for client:
Name: ${client.name}
Program: ${client.program}
Started: ${client.program_started_at}

Recent check-ins:
${checkinSummary}

${prevProgramSummary}

Design the next week's training and nutrition plan. Progress from the previous week if available. Return JSON only.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Failed to parse program JSON');
      return res.status(500).json({ error: 'Invalid program format from AI' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
    if (flagged) {
      await escalateToMaddy('Safety flag in generated program', {
        phone: maskPhone(client.phone),
        message: `Week ${week_no} program flagged for review — potential unsafe content`
      });
      return res.status(200).json({
        ok: false,
        reason: 'flagged_for_review',
        message: 'Program flagged for Maddy review'
      });
    }

    const pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan: programData.workout_plan,
      nutritionPlan: programData.nutrition_plan,
      notes: programData.notes
    });

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: pdfUrlData } = db.storage.from('client-files').getPublicUrl(pdfPath);
    const pdfUrl = pdfUrlData.publicUrl;

    const { error: progErr } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    }, {
      onConflict: 'client_id,week_no'
    });

    if (progErr) {
      console.error('Program save error:', progErr.message);
    }

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [client.name || 'there', `${week_no}`, pdfUrl]
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ ok: true, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
