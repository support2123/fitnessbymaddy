const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { getProgramName } = require('../lib/qualify');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = {};
    try {
      if (intakeMsg && intakeMsg.body) intakeData = JSON.parse(intakeMsg.body);
    } catch (e) { /* ignore parse errors */ }

    const prompt = buildPrompt(client, week_no, recentCheckins || [], intakeData);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch (e) {
      console.error('Failed to parse Claude response as JSON');
      await notifyMaddy('Program generation parse error', `Client: ${client.name}\nWeek: ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.filter(f => fullText.includes(f));
    if (flagged.length > 0) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${client.name}\nWeek: ${week_no}\nFlags: ${flagged.join(', ')}`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged', flags: flagged });
    }

    const pdfBuffer = await generateProgramPDF(
      client,
      week_no,
      parsed.workout,
      parsed.nutrition,
      parsed.notes
    );

    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(filePath);

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: parsed.workout,
      nutrition_plan: parsed.nutrition,
      notes: parsed.notes
    });

    await sendTemplate(client.phone, 'program_ready', [
      client.name || 'there',
      `Week ${week_no} program is ready! ${parsed.notes ? parsed.notes.slice(0, 100) : 'Check it out.'}`
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: publicUrl?.publicUrl });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, weekNo, checkins, intake) {
  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  return `You are a world-class fitness program architect for FitnessByMaddy, an elite online coaching brand.

Generate a Week ${weekNo} customized training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${getProgramName(client.program)}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Experience: ${intake.experience_level || 'intermediate'}
- Injuries/limitations: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_preference || 'no restriction'}
- Schedule: ${intake.schedule || 'flexible'}

LATEST CHECK-IN (Week ${lastCheckin.week_no || 'N/A'}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'none'}

PREVIOUS CHECK-IN (Week ${prevCheckin.week_no || 'N/A'}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10

RULES:
- Never recommend below 1200 kcal/day for women or 1500 kcal/day for men
- No banned substances or supplements beyond basic protein/creatine/vitamins
- Be realistic with timelines (0.5-1kg fat loss per week max)
- If compliance is low, reduce volume slightly and add motivation notes
- If energy is low, check if calories are too low or training volume too high

Return ONLY valid JSON in this exact format:
\`\`\`json
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fats": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": "4 eggs, 2 toast, 1 banana" }
    ]
  },
  "notes": "One line coach note for this week"
}
\`\`\``;
}
