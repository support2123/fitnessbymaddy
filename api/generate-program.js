const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'sarm', 'steroid', 'tren',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for Fitness by Maddy.
You create weekly customized workout and nutrition plans for clients.

RULES:
- Plans must be safe, evidence-based, and appropriate for the client's level
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or supplements without evidence
- Be progressive: build on previous weeks, adjust based on check-in data
- Include rest days and deload guidance
- Nutrition should be practical and culturally appropriate

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ],
        "notes": "Focus on mind-muscle connection"
      }
    ],
    "weekly_notes": "Progressive overload from last week"
  },
  "nutrition_plan": {
    "dailyTargets": { "calories": 2000, "protein": "150g", "water": "3L" },
    "meals": [
      {
        "meal": "Meal 1 - Breakfast",
        "items": ["4 egg whites + 1 whole egg", "1 cup oats with berries"],
        "macros": "P: 30g | C: 45g | F: 8g"
      }
    ]
  },
  "context_note": "One-liner summary for WhatsApp message"
}`;

    const userPrompt = buildUserPrompt(client, checkins, prevPrograms, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse program JSON from Claude response');
    }

    const program = JSON.parse(jsonMatch[0]);

    const safetyCheck = checkSafety(responseText);
    if (safetyCheck) {
      await escalateToMaddy({
        reason: `Safety flag in generated program: ${safetyCheck}`,
        phone: client.phone,
        message: `Week ${week_no} program flagged for review`,
        clientName: client.name,
      });
      return res.status(200).json({ status: 'flagged_for_review', flag: safetyCheck });
    }

    const pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan: program.workout_plan,
      nutritionPlan: program.nutrition_plan,
      notes: program.context_note,
    });

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData.publicUrl || pdfPath,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.context_note,
    });

    if (insertError) throw insertError;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [
        client.name || 'Champion',
        `${week_no}`,
        program.context_note || 'Your personalized plan is ready!',
      ],
      mediaUrl: urlData.publicUrl,
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ status: 'generated', week_no, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function buildUserPrompt(client, checkins, prevPrograms, weekNo) {
  let prompt = `Generate Week ${weekNo} program for:\n`;
  prompt += `Client: ${client.name || 'Unknown'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Started: ${client.program_started_at}\n\n`;

  if (checkins && checkins.length > 0) {
    prompt += 'RECENT CHECK-INS:\n';
    for (const c of checkins) {
      prompt += `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    }
    prompt += '\n';
  }

  if (prevPrograms && prevPrograms.length > 0) {
    prompt += 'PREVIOUS WEEK SUMMARY:\n';
    const prev = prevPrograms[0];
    prompt += `Week ${prev.week_no} notes: ${prev.notes || 'None'}\n\n`;
  }

  prompt += `Please generate the Week ${weekNo} plan. Respond with ONLY the JSON object.`;
  return prompt;
}

function checkSafety(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}
