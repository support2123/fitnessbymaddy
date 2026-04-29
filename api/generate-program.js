const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish, maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'starvation',
  'banned substance', 'steroid', 'sarm', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'crash diet', 'very low calorie'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*, lead:leads(market)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect working for Fitness by Maddy.
You generate weekly workout and nutrition plans for clients.

Rules:
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, steroids, or unsafe supplements
- Set realistic timelines (0.5-1kg fat loss per week max)
- Factor in client's compliance score and energy levels from check-ins
- Progressive overload: increase volume/intensity gradually
- Account for injuries and medical conditions
- Output MUST be valid JSON matching the schema below

Output JSON schema:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Push",
        "focus": "Chest, Shoulders, Triceps",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["4 egg whites + 1 whole egg", "1 cup oats"] }
    ]
  },
  "notes": "Coach notes for the client about this week's focus",
  "context_note": "One-liner summary to send on WhatsApp"
}`;

    const userPrompt = buildUserPrompt(client, week_no, recentCheckins, prevPrograms);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude response did not contain valid JSON');
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => fullText.includes(f));
    if (flagged) {
      await sendWhatsApp('917082478374', 'escalation_alert', [
        'Program flagged for safety review',
        maskPhone(client.phone)
      ]);
      return res.status(200).json({ flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generateProgramPDF(
      client, week_no,
      programData.workout_plan,
      programData.nutrition_plan,
      programData.notes
    );

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client_id}/${fileName}`;

    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(storagePath);
    const pdfUrl = publicUrl?.publicUrl || storagePath;

    const { data: program, error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    }).select().single();

    if (insertErr) throw insertErr;

    const contextNote = programData.context_note || `Your Week ${week_no} program is ready!`;
    await sendWhatsApp(client.phone, 'program_delivery', [
      client.name || 'there',
      contextNote
    ], pdfUrl);

    await db.from('programs').update({
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

function buildUserPrompt(client, weekNo, checkins, prevPrograms) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Started: ${client.program_started_at}\n\n`;

  if (checkins && checkins.length > 0) {
    prompt += `Recent Check-ins:\n`;
    for (const ci of checkins) {
      prompt += `- Week ${ci.week_no}: Weight ${ci.weight || 'N/A'}kg, Waist ${ci.waist || 'N/A'}cm, `;
      prompt += `Compliance ${ci.compliance_score || 'N/A'}/10, Energy ${ci.energy || 'N/A'}/10`;
      if (ci.issues) prompt += `, Issues: ${ci.issues}`;
      prompt += `\n`;
    }
    prompt += `\n`;
  }

  if (prevPrograms && prevPrograms.length > 0) {
    const prev = prevPrograms[0];
    prompt += `Previous Week ${prev.week_no} focus: ${prev.notes || 'Standard progression'}\n\n`;
  }

  prompt += `Generate the next week's workout and nutrition plan. `;
  prompt += `Progress appropriately based on check-in data. `;
  prompt += `Output valid JSON only.`;

  return prompt;
}
