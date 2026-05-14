const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');
const { notifyMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    const { data: intakeFile } = await supabase.storage
      .from('clients')
      .download(`intake/${client.lead_id || client.id}.json`);

    let intakeData = null;
    if (intakeFile) {
      try {
        intakeData = JSON.parse(await intakeFile.text());
      } catch (_) {}
    }

    const prompt = buildPrompt(client, recentCheckins || [], intakeData, week_no);

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    const lowerContent = content.toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (lowerContent.includes(flag)) {
        await notifyMaddy(supabase, sendWhatsApp,
          'Program flagged for safety review',
          `Client: ${maskPhone(client.phone)} Week ${week_no}\nFlag: "${flag}" found in generated program`
        );
        await supabase.from('programs').insert({
          client_id, week_no,
          notes: `FLAGGED FOR REVIEW: Contains "${flag}"`,
          workout_plan: {},
          nutrition_plan: {},
        });
        return res.status(200).json({ success: false, flagged: true, reason: flag });
      }
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch (_) {
      parsed = { workout: { days: [] }, nutrition: {}, notes: content };
    }

    const workout = parsed.workout || parsed.workout_plan || { days: [] };
    const nutrition = parsed.nutrition || parsed.nutrition_plan || {};
    const notes = parsed.notes || parsed.coach_notes || '';

    const pdfBuffer = await generateProgramPDF(client, week_no, workout, nutrition, notes);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload failed:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: workout,
      nutrition_plan: nutrition,
      notes,
    });

    await sendWhatsApp(client.phone,
      `Your Week ${week_no} program is ready! 📋\n\n${notes ? 'Focus this week: ' + notes.slice(0, 150) : 'Check your program PDF for full details.'}`,
      'program_delivery'
    );

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: urlData?.publicUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let context = `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
`;

  if (intake) {
    context += `- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Injuries/Conditions: ${intake.injuries || 'None reported'}
- Diet preference: ${intake.diet_preference || 'No preference'}
- Schedule: ${intake.schedule || 'Flexible'}
- Experience: ${intake.experience || 'Intermediate'}
- Height: ${intake.height || 'Unknown'}
- Current Weight: ${intake.current_weight || 'Unknown'}
- Target Weight: ${intake.target_weight || 'Unknown'}
`;
  }

  if (lastCheckin) {
    context += `
LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'Not reported'}
- Waist: ${lastCheckin.waist || 'Not reported'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}
`;
  }

  if (prevCheckin) {
    context += `
PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'Not reported'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10
`;
  }

  context += `
INSTRUCTIONS:
- Create a complete weekly workout plan (4-6 training days) with exercises, sets, reps, and rest periods
- Create a nutrition plan with daily calories, macros, and 4-5 meal suggestions
- Add brief coach notes about focus areas for this week
- Adjust based on compliance, energy levels, and progress from check-ins
- Be safe and evidence-based. No extreme calorie deficits (minimum 1200kcal women, 1500kcal men)
- No banned substances or unrealistic timelines

Respond in this exact JSON format:
\`\`\`json
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2000,
    "macros": { "protein": 150, "carbs": 200, "fat": 67 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "..." }
    ]
  },
  "notes": "Brief coach notes here"
}
\`\`\``;

  return context;
}
