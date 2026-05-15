const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { notifyMaddy } = require('./_lib/escalation');
const { generateProgramPdf } = require('./_lib/pdf');
const cors = require('./_lib/cors');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800',
  'clenbuterol', 'dnp', 'dinitrophenol', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'zero carb for extended'
];

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'client not found' });

    // Fetch last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Fetch intake data from storage
    let intakeData = null;
    try {
      const { data: intakeBlob } = await supabase.storage
        .from('client-data')
        .download(`intakes/${client.lead_id}.json`);
      if (intakeBlob) {
        intakeData = JSON.parse(await intakeBlob.text());
      }
    } catch (_) {}

    const prompt = buildPrompt(client, week_no, checkins || [], intakeData);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0].text;

    // Safety check
    const lower = raw.toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (lower.includes(flag)) {
        await notifyMaddy(
          'Program Safety Flag',
          `Client: ${client.name} (${client.id})\nWeek: ${week_no}\nFlag: "${flag}"\n\nGenerated content flagged for review.`
        );
        await supabase.from('programs').insert({
          client_id, week_no,
          workout_plan: null, nutrition_plan: null,
          notes: `FLAGGED: safety keyword "${flag}" detected — awaiting Maddy review`,
          pdf_url: null
        });
        return res.json({ action: 'flagged', flag });
      }
    }

    let parsed;
    try {
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
      parsed = JSON.parse(jsonMatch[1]);
    } catch (_) {
      return res.status(500).json({ error: 'failed to parse Claude response' });
    }

    const { workout_plan, nutrition_plan } = parsed;

    // Generate PDF
    const pdfBuffer = await generateProgramPdf(client, week_no, workout_plan, nutrition_plan);
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('client-data')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    const { data: urlData } = supabase.storage.from('client-data').getPublicUrl(pdfPath);
    const pdfUrl = urlData.publicUrl;

    // Save to programs table
    await supabase.from('programs').insert({
      client_id, week_no,
      workout_plan, nutrition_plan,
      pdf_url: pdfUrl,
      notes: parsed.coach_note || null
    });

    // Send via WhatsApp
    const contextNote = parsed.coach_note || `Week ${week_no} program ready!`;
    await sendTemplate(client.phone, 'weekly_program', [client.name || 'there', String(week_no)], pdfUrl);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function buildPrompt(client, weekNo, checkins, intake) {
  let context = `You are a program architect for FitnessByMaddy, an elite online fitness coaching brand.
Generate a Week ${weekNo} training and nutrition program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
`;

  if (intake) {
    context += `
INTAKE DATA:
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Injuries: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_preference || 'no restriction'}
- Schedule: ${intake.schedule || 'flexible'}
- Equipment: ${intake.equipment_access || 'full gym'}
- Medical conditions: ${intake.medical_conditions || 'none reported'}
`;
  }

  if (checkins.length > 0) {
    context += '\nRECENT CHECK-INS:\n';
    for (const c of checkins) {
      context += `Week ${c.week_no}: weight=${c.weight || '?'}kg, waist=${c.waist || '?'}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"\n`;
    }
  }

  context += `
RESPOND IN THIS EXACT JSON FORMAT (no other text):
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ],
        "notes": "optional note"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 65 },
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": ["4 egg whites + 1 whole egg scrambled", "1 cup oats with berries"],
        "notes": "optional"
      }
    ],
    "notes": "General nutrition notes"
  },
  "coach_note": "One-liner context for this week's focus"
}
\`\`\`

RULES:
- Be specific with exercises, sets, reps, and rest periods
- Adjust based on check-in data (progress, energy, issues)
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or unrealistic timelines
- Keep meals practical and culturally appropriate
- If client reports pain/injury, reduce load on affected area and note it`;

  return context;
}
