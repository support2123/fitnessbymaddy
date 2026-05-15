const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendMedia, notifyMaddy } = require('./_lib/whatsapp');
const { generateProgramPDF } = require('./_lib/pdf');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'starvation',
  'banned substance', 'steroid', 'ephedra', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet', 'water fast',
  'extreme dehydration', 'diuretic'
];

function checkProgramSafety(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.filter(f => lower.includes(f));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body || {};
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

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const prompt = `You are Maddy's program architect for FitnessByMaddy. Generate a weekly fitness program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${week_no}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

${prevProgram ? `PREVIOUS PROGRAM NOTES: ${prevProgram.notes || 'None'}` : 'This is the first week.'}

INSTRUCTIONS:
- Create a progressive, evidence-based program for this week
- Adjust based on check-in data (compliance, energy, issues)
- Be specific with exercises, sets, reps, and rest periods
- Nutrition should include calories, macros, and 4-5 meals
- Be warm and encouraging in tone
- NEVER recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- NEVER recommend banned substances or extreme measures
- If the client reported issues, address them specifically

Return ONLY valid JSON in this exact format:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": "4", "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein": 140,
    "carbs": 200,
    "fat": 60,
    "water": "3-4 liters",
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": ["4 egg whites + 1 whole egg scramble", "1 cup oats with berries"],
        "notes": ""
      }
    ]
  },
  "notes": "Brief coach note about this week's focus and encouragement"
}`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content[0]?.text || '';

    const safetyIssues = checkProgramSafety(responseText);
    if (safetyIssues.length > 0) {
      await notifyMaddy(
        'Program generation flagged - safety review needed',
        `Client: ${client.name || client.id}\nWeek ${week_no}\nFlags: ${safetyIssues.join(', ')}\nPlease review before sending.`
      );
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        flags: safetyIssues
      });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const pdfBuffer = await generateProgramPDF(
      client,
      week_no,
      programData.workout_plan,
      programData.nutrition_plan,
      programData.notes
    );

    const pdfPath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: publicUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    const { data: program, error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl.publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    }).select().single();

    if (insertError) {
      console.error('Program insert error:', insertError);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const sendResult = await sendMedia(
      client.phone,
      'weekly_program',
      publicUrl.publicUrl,
      [client.name || 'Champion', `Week ${week_no}`, programData.notes?.substring(0, 100) || 'Your new program is ready!']
    );

    if (sendResult.success) {
      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: publicUrl.publicUrl
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
