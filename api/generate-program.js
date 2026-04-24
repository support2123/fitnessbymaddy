const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'sarm',
  'lose 10kg in 1 week', 'crash diet',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1);

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      checkins: checkins || [],
      intake: intake && intake[0] ? intake[0] : {},
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: `You are a certified fitness program architect for FitnessByMaddy.
Generate a personalised weekly training and nutrition program.
Output ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "2 min rest" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fat": 70,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "4 eggs, 2 toast, 1 banana" }
    ]
  },
  "notes": "Coach notes for the week"
}
Rules:
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or steroids
- Never promise unrealistic timelines (>1kg/week fat loss)
- Adapt based on check-in compliance, energy levels, and reported issues
- If the client reported injuries or pain, modify exercises accordingly`,
      messages: [
        {
          role: 'user',
          content: `Generate Week ${week_no} program for this client:\n${JSON.stringify(clientProfile, null, 2)}`,
        },
      ],
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy(
        'Program generation failed - invalid JSON',
        `Client: ${client.name} (${client_id}), Week: ${week_no}`,
        { supabase }
      );
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const program = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(program).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
    if (flagged) {
      await escalateToMaddy(
        'Safety flag in generated program',
        `Client: ${client.name} (${client_id}), Week: ${week_no}\nFlagged content detected — halted auto-send.`,
        { supabase }
      );
      return res.status(200).json({
        ok: false,
        reason: 'safety_flagged',
        client_id,
        week_no,
      });
    }

    const pdfBuffer = await generateProgramPDF(
      client, week_no,
      program.workout, program.nutrition, program.notes
    );

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: program.workout,
      nutrition_plan: program.nutrition,
      notes: program.notes,
    });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name,
      String(week_no),
    ], { supabase });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      ok: true,
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || filePath,
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
