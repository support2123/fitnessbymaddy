const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendDocument, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

const BANNED_CONTENT = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'anabolic', 'steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasBannedContent(text) {
  const lower = text.toLowerCase();
  return BANNED_CONTENT.find(term => lower.includes(term));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const clientProfile = {
      name: client.name,
      age: client.age,
      goal: client.goal,
      injuries: client.injuries,
      diet: client.diet_preference,
      schedule: client.schedule,
      program: client.program,
      weekNumber: week_no
    };

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Create safe, science-backed, personalised weekly workout and nutrition plans.

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- Never suggest banned substances or extreme protocols
- Account for injuries and medical conditions conservatively
- Progressive overload: build on previous weeks
- Be specific with sets, reps, rest times, and food portions
- Output MUST be valid JSON matching the schema below`;

    const userPrompt = `Generate Week ${week_no} program for this client.

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

PREVIOUS WEEK PROGRAM:
${prevProgram ? JSON.stringify({ workout: prevProgram.workout_plan, nutrition: prevProgram.nutrition_plan }, null, 2) : 'None (first week)'}

Return JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Monday",
        "name": "Upper Body Push",
        "focus": "Chest, Shoulders, Triceps",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "time": "7:00 AM",
        "items": ["3 whole eggs scrambled", "2 toast whole wheat", "1 banana"],
        "macros": "P: 25g | C: 45g | F: 15g"
      }
    ],
    "dailyTotals": "Calories: 2000 | Protein: 150g | Carbs: 200g | Fat: 65g"
  },
  "notes": "Focus on progressive overload this week. Increase weights by 2.5kg on compound lifts if last week's compliance was good."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await notifyMaddy('Program Generation Failed', `Could not parse JSON for ${client.name} Week ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData).toLowerCase();
    const banned = hasBannedContent(fullText);
    if (banned) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        trigger_type: 'unsafe_program_content',
        trigger_message: `Week ${week_no}: flagged term "${banned}"`
      });
      await notifyMaddy(
        'Program Flagged — Unsafe Content',
        `${client.name} (${maskPhone(client.phone)}) Week ${week_no}: contains "${banned}". NOT auto-sent.`
      );
      return res.status(200).json({ action: 'flagged', reason: banned });
    }

    const pdfBuffer = await generateProgramPDF(
      client.name,
      week_no,
      programData.workout_plan,
      programData.nutrition_plan,
      programData.notes
    );

    const filePath = `${client.folder_url}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(filePath);
    const pdfUrl = urlData.publicUrl;

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
      pdf_url: pdfUrl,
      generated_at: new Date().toISOString()
    }).select('id').single();

    const caption = `Week ${week_no} program is ready! 🔥 Check your workout and nutrition plan.`;
    await sendDocument(client.phone, pdfUrl, caption, true);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
