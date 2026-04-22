const Anthropic = require('@anthropic-ai/sdk');
const { getClient } = require('./_lib/supabase');
const { generateProgramPdf } = require('./_lib/pdf');
const { sendTemplate } = require('./_lib/whatsapp');
const { notifyMaddy } = require('./_lib/notify');

const SAFETY_FLAGS = [
  'under 1000 calories', 'under 800 calories', 'extreme cut',
  'clenbuterol', 'dnp', 'sarm', 'steroid', 'anavar',
  'lose 10 kg in 1 week', 'lose 20 pounds in',
  'starvation', 'very low calorie',
];

function auditProgramSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.filter(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getClient();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Load client
    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

    // Load last 2 check-ins
    const { data: checkins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Load intake form for initial context
    const { data: intake } = await sb
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1);

    const intakeData = intake && intake[0] ? intake[0] : {};

    // Build Claude prompt
    const systemPrompt = `You are an expert fitness coach (NASM-certified) designing a weekly training and nutrition program. You produce structured JSON output only. Never recommend extreme calorie restriction (below 1200 kcal for women, 1500 for men), banned substances, or unrealistic timelines. Be evidence-based, warm, and practical.`;

    const userPrompt = `Design Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${intakeData.goal || 'general fitness'}
- Age: ${intakeData.age || 'not provided'}
- Gender: ${intakeData.gender || 'not provided'}
- Injuries/Limitations: ${intakeData.injuries || 'none reported'}
- Diet Preference: ${intakeData.diet_preference || 'flexible'}
- Schedule: ${intakeData.schedule || 'flexible'}
- Experience: ${intakeData.experience || 'intermediate'}

RECENT CHECK-INS:
${checkins && checkins.length > 0
  ? checkins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')
  : 'No check-ins yet (first week)'}

Respond with ONLY valid JSON in this exact format:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fats": 70,
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": ["3 eggs scrambled", "1 cup oats with berries"]
      }
    ]
  },
  "notes": "One paragraph coach note for the client about this week's focus."
}`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    // Safety audit
    const flags = auditProgramSafety(responseText);
    if (flags.length > 0) {
      await notifyMaddy(
        'Program Safety Flag',
        `Client: ${client.name} (${client.id})\nWeek: ${week_no}\nFlags: ${flags.join(', ')}\n\nProgram halted — needs manual review.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged', flags });
    }

    // Parse JSON from response
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (_) {
      return res.status(500).json({ error: 'failed to parse program JSON' });
    }

    const { workout, nutrition, notes } = programData;

    // Generate PDF
    const pdfBuffer = await generateProgramPdf(client, week_no, workout, nutrition, notes);

    // Upload to Supabase Storage
    const pdfPath = `${client.folder_url || 'clients/' + client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await sb.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) console.error('PDF upload error:', uploadErr.message);

    const { data: urlData } = sb.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Save to programs table (audit trail)
    const { data: program, error: insertErr } = await sb.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workout,
      nutrition_plan: nutrition,
      notes,
    }, {
      onConflict: 'client_id,week_no',
    }).select().single();

    if (insertErr) throw insertErr;

    // Send via WhatsApp
    const contextNote = notes
      ? notes.substring(0, 120) + (notes.length > 120 ? '...' : '')
      : `Week ${week_no} program ready!`;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      contextNote,
      pdfUrl,
    ], true);

    // Update sent timestamp
    await sb.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, programId: program.id, pdfUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
