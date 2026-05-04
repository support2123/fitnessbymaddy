const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsAppMedia } = require('../lib/whatsapp');
const { generateProgramPDF } = require('../lib/pdf-generator');
const { isHinglish } = require('../lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroids', 'sarms', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in 2 weeks',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildProgramPrompt(client, intake, recentCheckins, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programData = JSON.parse(jsonMatch[1]);

    for (const flag of SAFETY_FLAGS) {
      if (responseText.toLowerCase().includes(flag)) {
        const { sendWhatsApp } = require('../lib/whatsapp');
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy(client.phone, 'unsafe_program_content', `Week ${week_no} program flagged: ${flag}`);
        return res.status(200).json({ ok: false, reason: 'safety_flagged', flag });
      }
    }

    const pdfBuffer = await generateProgramPDF(
      client.name,
      week_no,
      programData.workout_plan,
      programData.nutrition_plan,
      programData.notes
    );

    const pdfPath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: dbError } = await supabase.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
    }, { onConflict: 'client_id,week_no' });

    if (dbError) throw dbError;

    const market = client.leads?.market || 'GLOBAL';
    const contextNote = isHinglish(market)
      ? `Week ${week_no} ka program ready hai! 💪 Check kar aur questions ho toh pooch.`
      : `Your Week ${week_no} program is ready! 💪 Check it out and let us know if you have questions.`;

    const sendResult = await sendWhatsAppMedia(client.phone, 'weekly_program', pdfUrl, [
      client.name || 'there',
      contextNote,
    ]);

    if (sendResult.ok) {
      await supabase.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, intake, checkins, weekNo) {
  const profile = [];
  profile.push(`Client: ${client.name || 'Unknown'}`);
  profile.push(`Program: ${client.program}`);
  profile.push(`Week: ${weekNo} of 12`);

  if (intake) {
    if (intake.age) profile.push(`Age: ${intake.age}`);
    if (intake.gender) profile.push(`Gender: ${intake.gender}`);
    if (intake.goal) profile.push(`Goal: ${intake.goal}`);
    if (intake.injuries) profile.push(`Injuries/limitations: ${intake.injuries}`);
    if (intake.medical_conditions) profile.push(`Medical: ${intake.medical_conditions}`);
    if (intake.diet_preference) profile.push(`Diet preference: ${intake.diet_preference}`);
    if (intake.workout_schedule) profile.push(`Schedule: ${intake.workout_schedule}`);
    if (intake.current_fitness) profile.push(`Current fitness: ${intake.current_fitness}`);
  }

  let checkinContext = '';
  if (checkins && checkins.length > 0) {
    checkinContext = '\n\nRecent check-in data:\n';
    for (const c of checkins) {
      checkinContext += `- Week ${c.week_no}: Weight ${c.weight || '—'}kg, Waist ${c.waist || '—'}cm, Compliance ${c.compliance_score || '—'}/10, Energy ${c.energy || '—'}/10`;
      if (c.issues) checkinContext += `, Issues: ${c.issues}`;
      checkinContext += '\n';
    }
  }

  return `You are a NASM-certified fitness coach creating a weekly program for a client. Be specific, evidence-based, and practical.

CLIENT PROFILE:
${profile.join('\n')}
${checkinContext}

Create a complete Week ${weekNo} program. Output ONLY a JSON block in this exact format:

\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ],
        "notes": "Optional day note"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fats": 70,
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": ["4 egg whites + 1 whole egg scramble", "1 cup oats with berries"]
      }
    ]
  },
  "notes": "Coach notes for the week - focus areas, mindset tips, adjustments from last week"
}
\`\`\`

RULES:
- 4-6 training days depending on client schedule
- Include warm-up and cool-down notes
- Nutrition must be realistic and sustainable (no extreme deficits)
- Never recommend banned substances or extreme protocols
- If client reported issues, address them in notes and adjust exercises
- Progressive overload from previous week if check-in data available
- Calories must be at least 1200 for women, 1500 for men`;
}
