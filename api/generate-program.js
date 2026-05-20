const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { generateProgramPdf } = require('../lib/pdf');
const { sendToClient } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in',
  'starvation', 'zero carb for weeks',
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
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a world-class fitness program architect for "Fitness by Maddy", an elite online coaching brand. You design weekly workout and nutrition plans that are science-backed, personalized, and progressive.

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances, steroids, or dangerous supplements
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Always include rest days and deload guidance
- Adjust based on compliance scores and reported issues
- Be warm and motivating in notes, matching the brand voice

OUTPUT FORMAT: Return valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "focus": "Chest, Shoulders, Triceps",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": "4", "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      },
      { "name": "Day 4 - Rest", "rest": true }
    ]
  },
  "nutrition_plan": {
    "summary": "Brief nutrition strategy for this week",
    "macros": { "calories": "2200", "protein": "180g", "carbs": "220g", "fats": "70g" },
    "meals": [
      { "name": "Meal 1 - Breakfast", "time": "7:00 AM", "options": ["Option A description", "Option B description"] }
    ],
    "hydration": "3-4 liters of water daily, electrolytes post-workout"
  },
  "notes": "Motivational and tactical notes for the week"
}`;

    const userPrompt = buildUserPrompt(client, week_no, recentCheckins, lastProgram);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawOutput = response.content[0].text;

    for (const flag of SAFETY_FLAGS) {
      if (rawOutput.toLowerCase().includes(flag)) {
        const { notifyMaddy } = require('../lib/whatsapp');
        await notifyMaddy(
          `Safety flag in generated program: "${flag}"`,
          `Client: ${maskPhone(client.phone)}, Week ${week_no}`
        );
        return res.status(200).json({ status: 'flagged_for_review', flag });
      }
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const pdfBuffer = await generateProgramPdf(
      client,
      week_no,
      parsed.workout_plan,
      parsed.nutrition_plan,
      parsed.notes
    );

    const pdfPath = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program, error: dbErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
    }).select().single();

    if (dbErr) {
      console.error('Program DB insert error:', dbErr.message);
    }

    await sendToClient(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      parsed.notes ? parsed.notes.slice(0, 200) : 'Your new weekly plan is ready!',
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program?.id);

    console.log(`Program generated: client ${client_id}, week ${week_no}`);
    return res.status(200).json({ status: 'generated', program_id: program?.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildUserPrompt(client, weekNo, checkins, lastProgram) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `CLIENT PROFILE:\n`;
  prompt += `- Name: ${client.name || 'Client'}\n`;
  prompt += `- Program: ${client.program}\n`;
  prompt += `- Goal: ${client.goal || 'General fitness and fat loss'}\n`;
  prompt += `- Age: ${client.age || 'Not specified'}\n`;
  prompt += `- Injuries/Limitations: ${client.injuries || 'None reported'}\n`;
  prompt += `- Diet Preference: ${client.diet_pref || 'No restrictions'}\n`;
  prompt += `- Available Schedule: ${client.schedule || 'Flexible'}\n\n`;

  if (checkins && checkins.length > 0) {
    prompt += `RECENT CHECK-INS:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, `;
      prompt += `Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      if (c.next_week_focus) prompt += `, Focus: ${c.next_week_focus}`;
      prompt += `\n`;
    }
    prompt += `\n`;
  }

  if (lastProgram) {
    prompt += `LAST WEEK'S PROGRAM SUMMARY:\n`;
    if (lastProgram.notes) prompt += `- Notes: ${lastProgram.notes.slice(0, 300)}\n`;
    prompt += `\n`;
  }

  prompt += `Design a progressive, personalized program for Week ${weekNo}. `;
  prompt += `Adjust intensity based on check-in data. Be specific with exercises, sets, reps, and nutrition.`;

  return prompt;
}
