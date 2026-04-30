const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

const SAFETY_FLAGS = [
  'below 1000 cal', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'hgh',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: leadData } = client.lead_id
      ? await supabase.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a program architect for Fitness by Maddy, an elite online coaching brand. You generate weekly workout and nutrition plans in JSON format.

Rules:
- Plans must be safe, evidence-based, and progressive
- Never recommend extreme calorie cuts below 1200 kcal for women or 1500 for men
- Never recommend banned substances, steroids, or SARMs
- Never promise unrealistic timelines (e.g., "lose 10kg in a week")
- Include proper warm-up and cool-down in workouts
- Account for injuries and medical conditions noted in client profile
- Adjust based on previous check-in compliance and energy scores

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "name": "Day 1 — Upper Push", "exercises": [{ "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "RPE 7-8" }] }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 70 },
    "meals": [
      { "name": "Meal 1 — Breakfast", "items": ["4 egg whites + 1 whole egg scrambled", "1 cup oats with berries"] }
    ]
  },
  "notes": "Focus on progressive overload this week. Increase bench press by 2.5kg from last week."
}`;

    const userPrompt = buildUserPrompt(client, leadData, recentCheckins, week_no);

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await notifyMaddy('Program generation failed', `Client ${client_id} week ${week_no}: Claude returned non-JSON`);
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const program = JSON.parse(jsonMatch[0]);

    const lowerRaw = rawText.toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => lowerRaw.includes(flag));
    if (flagged) {
      await notifyMaddy(
        'Safety flag in generated program',
        `Client ${client_id} week ${week_no}: Program flagged for review before sending`
      );
      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: `[FLAGGED FOR REVIEW] ${program.notes || ''}`
      });
      return res.status(200).json({ ok: true, flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan: program.workout_plan,
      nutritionPlan: program.nutrition_plan,
      notes: program.notes
    });

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: publicUrl } = supabase.storage.from('programs').getPublicUrl(pdfPath);

    const { data: programRecord } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl.publicUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.notes
    }).select().single();

    const hinglish = leadData ? isHinglish(leadData.market) : false;
    const contextNote = program.notes
      ? program.notes.split('.')[0]
      : `Week ${week_no} program ready`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: hinglish
        ? `Week ${week_no} ka program ready hai! 💪\n${contextNote}\n\nPDF: ${publicUrl.publicUrl}`
        : `Your Week ${week_no} program is ready! 💪\n${contextNote}\n\nPDF: ${publicUrl.publicUrl}`,
      params: [String(week_no), publicUrl.publicUrl]
    });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', programRecord.id);

    return res.status(200).json({ ok: true, program_id: programRecord.id, pdf_url: publicUrl.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, lead, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Unknown'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (lead?.intake_data) {
    const d = lead.intake_data;
    prompt += `Age: ${d.age || 'N/A'}, Gender: ${d.gender || 'N/A'}\n`;
    prompt += `Height: ${d.height || 'N/A'}, Weight: ${d.weight || 'N/A'}\n`;
    prompt += `Goal: ${d.goal || 'N/A'}\n`;
    prompt += `Injuries: ${d.injuries || 'None'}\n`;
    prompt += `Medical: ${d.medical_conditions || 'None'}\n`;
    prompt += `Diet: ${d.diet_preference || 'No preference'}\n`;
    prompt += `Schedule: ${d.schedule || 'Flexible'}\n`;
    prompt += `Experience: ${d.experience_level || 'Intermediate'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, `;
      prompt += `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      if (c.next_week_focus) prompt += `, Focus: ${c.next_week_focus}`;
      prompt += `\n`;
    }
  }

  return prompt;
}
