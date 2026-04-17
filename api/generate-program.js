const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { generateProgramPDF, uploadPDF } = require('./_lib/pdf');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'under 1000',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'crash diet', 'lose 10kg in a week', 'detox tea'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
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

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('first_msg').eq('id', client.lead_id).single()
      : { data: null };

    const intakeData = lead && lead.first_msg && lead.first_msg.includes('---INTAKE---')
      ? lead.first_msg.split('---INTAKE---')[1]
      : null;

    const prompt = buildPrompt(client, checkins || [], intakeData, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    const safetyCheck = SAFETY_FLAGS.some(flag =>
      content.toLowerCase().includes(flag)
    );

    if (safetyCheck) {
      await notifyMaddy(
        'Program Safety Flag',
        `Client: ${client.name} (${client.id})\nWeek: ${week_no}\nGenerated content flagged for review. Please check and approve manually.`
      );
      return res.status(200).json({ ok: true, flagged: true, reason: 'safety_review' });
    }

    let workout, nutrition, notes;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[1] : content);
      workout = parsed.workout_plan || parsed.workout;
      nutrition = parsed.nutrition_plan || parsed.nutrition;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workout = { raw: content };
      nutrition = {};
      notes = '';
    }

    const pdfBuffer = await generateProgramPDF(client, week_no, workout, nutrition, notes);
    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workout,
      nutrition_plan: nutrition,
      notes
    }).select().single();

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Week ${week_no}`,
        notes ? notes.slice(0, 100) : 'Your updated program is ready!'
      ],
      media: { url: pdfUrl, filename: `week_${week_no}_program.pdf` }
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intakeData, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let prompt = `You are a certified fitness coach creating a weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
`;

  if (intakeData) {
    prompt += `\nINTAKE DATA:\n${intakeData}\n`;
  }

  if (lastCheckin) {
    prompt += `\nLATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
`;
  }

  if (prevCheckin) {
    prompt += `\nPREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
`;
  }

  prompt += `
RULES:
- Create a safe, evidence-based program
- Never suggest extreme calorie restriction (minimum 1200 kcal for women, 1500 for men)
- Never suggest banned substances or extreme measures
- Progressively overload from previous weeks
- Adjust based on compliance and energy levels
- If client reported pain or issues, modify exercises to accommodate

OUTPUT FORMAT — respond with a JSON block:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "macros": { "calories": 2000, "protein": 150, "carbs": 200, "fat": 65 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "..." }
    ]
  },
  "notes": "Brief coach note about this week's focus (1-2 sentences)"
}
\`\`\``;

  return prompt;
}
