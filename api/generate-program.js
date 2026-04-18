const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'sarms', 'steroids', 'anavar',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('intake_data, market').eq('id', client.lead_id).single()
      : { data: null };

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const intake = lead?.intake_data || {};

    const systemPrompt = `You are "Program Architect" for Fitness by Maddy, an elite online coaching brand. You create personalized weekly workout and nutrition plans.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, SARMs, steroids, or any PED
- Never promise unrealistic timelines (e.g., "lose 10kg in a week")
- Progressively overload from previous weeks
- Account for injuries, medical conditions, and diet preferences
- Be specific: exact exercises, sets, reps, rest periods, and meal portions
- Output ONLY valid JSON, no markdown, no explanation`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Experience: ${intake.experience || 'Intermediate'}
- Injuries: ${intake.injuries || 'None reported'}
- Diet preference: ${intake.diet_pref || 'No restriction'}
- Schedule: ${intake.schedule || 'Flexible'}
- Medical conditions: ${intake.medical_conditions || 'None'}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins.'}

${lastProgram ? `LAST WEEK'S PROGRAM SUMMARY:
Workout: ${JSON.stringify(lastProgram.workout_plan).slice(0, 500)}
Nutrition: ${JSON.stringify(lastProgram.nutrition_plan).slice(0, 500)}` : 'First week — build foundation.'}

OUTPUT FORMAT (strict JSON):
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ],
    "cardio": "description of weekly cardio recommendation",
    "notes": "any workout-specific notes"
  },
  "nutrition": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "3 eggs, 2 toast, 1 banana", "macros": { "protein": 25, "carbs": 45, "fat": 15 } }
    ],
    "hydration": "water intake recommendation",
    "supplements": "basic supplement recommendations if any"
  },
  "coach_notes": "1-2 sentence personalized note for the client",
  "focus": "This week's main focus area"
}`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].text;

    if (hasSafetyIssue(responseText)) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy('Program generation safety flag', {
        phone: maskPhone(client.phone),
        name: client.name,
        message: `Week ${week_no} program flagged for safety review`,
      });

      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: { flagged: true },
        nutrition_plan: { flagged: true },
        notes: 'SAFETY FLAGGED — awaiting Maddy review',
      });

      return res.status(200).json({ success: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Claude response was not valid JSON');
      }
    }

    const pdfBuffer = await generateProgramPDF(
      client.name,
      week_no,
      parsed.workout,
      parsed.nutrition,
      parsed.coach_notes
    );

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: urlData.publicUrl,
      workout_plan: parsed.workout,
      nutrition_plan: parsed.nutrition,
      notes: parsed.coach_notes || '',
    });

    if (insertErr) throw insertErr;

    try {
      const contextNote = parsed.focus || `Week ${week_no} program ready`;
      await sendTemplate(client.phone, 'program_delivery', [
        client.name || 'there',
        String(week_no),
        contextNote,
        urlData.publicUrl,
      ]);

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('client_id', client_id).eq('week_no', week_no);

      await db.from('messages').insert({
        phone: client.phone,
        direction: 'out',
        body: `Week ${week_no} program delivered`,
        template_name: 'program_delivery',
        sent_at: new Date().toISOString(),
        status: 'sent',
      });
    } catch (sendErr) {
      console.error(`Program WA send failed for ${maskPhone(client.phone)}:`, sendErr.message);
    }

    return res.status(200).json({
      success: true,
      pdf_url: urlData.publicUrl,
      week_no,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
