const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendText, notifyMaddy } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'clenbuterol', 'dnp', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'very low calorie'
];

function checkSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.filter(flag => lower.includes(flag));
}

async function generateWithClaude(client, checkins) {
  const anthropic = new Anthropic();

  const clientProfile = {
    name: client.name,
    program: client.program,
    intake: client.intake_data || {},
    program_started: client.program_started_at,
  };

  const recentCheckins = checkins.map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues,
  }));

  const nextWeek = checkins.length > 0 ? Math.max(...checkins.map(c => c.week_no)) + 1 : 1;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: `You are Maddy's program architect — a world-class fitness coach AI assistant.
Generate a weekly training and nutrition plan based on the client's profile and recent check-in data.

Output ONLY valid JSON with this structure:
{
  "week_no": <number>,
  "workout_plan": {
    "overview": "<brief week focus>",
    "days": [
      { "day": "Monday", "focus": "<muscle group>", "exercises": [
        { "name": "<exercise>", "sets": <n>, "reps": "<rep range>", "rest": "<rest time>", "notes": "<optional>" }
      ]}
    ],
    "cardio": "<cardio recommendation>",
    "rest_days": "<rest day guidance>"
  },
  "nutrition_plan": {
    "calories": <number>,
    "protein_g": <number>,
    "carbs_g": <number>,
    "fats_g": <number>,
    "meal_timing": "<guidance>",
    "hydration": "<guidance>",
    "supplements": ["<if applicable>"],
    "notes": "<any dietary notes>"
  },
  "coach_notes": "<motivational note from Maddy>"
}

Rules:
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Progressive overload week-to-week when data shows good compliance
- Adjust down if energy/compliance scores are low
- Address any reported issues
- Be warm, expert, and encouraging in coach notes
- Use Hinglish if client market is IN`,
    messages: [
      {
        role: 'user',
        content: `Client profile:\n${JSON.stringify(clientProfile, null, 2)}\n\nRecent check-ins:\n${JSON.stringify(recentCheckins, null, 2)}\n\nGenerate Week ${nextWeek} program.`
      }
    ]
  });

  const responseText = msg.content[0].text;

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');

  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(program, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 50, 40, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF').text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(4);
    doc.fillColor('#2C2C2C');

    const wp = program.workout_plan;
    if (wp) {
      doc.fontSize(18).fillColor('#B8965A').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      if (wp.overview) {
        doc.fontSize(11).fillColor('#6B6B6B').text(wp.overview);
        doc.moveDown(0.5);
      }

      if (wp.days) {
        for (const day of wp.days) {
          doc.moveDown(0.3);
          doc.fontSize(13).fillColor('#2C2C2C').text(`${day.day} — ${day.focus}`);
          if (day.exercises) {
            for (const ex of day.exercises) {
              const line = `  • ${ex.name}: ${ex.sets} x ${ex.reps}${ex.rest ? ` (rest ${ex.rest})` : ''}`;
              doc.fontSize(10).fillColor('#6B6B6B').text(line);
            }
          }
        }
      }

      if (wp.cardio) {
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor('#2C2C2C').text('Cardio: ').fillColor('#6B6B6B').text(wp.cardio, { continued: false });
      }
    }

    doc.moveDown(1);
    const np = program.nutrition_plan;
    if (np) {
      doc.fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN');
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#2C2C2C');
      doc.text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fats: ${np.fats_g}g`);
      if (np.meal_timing) {
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#6B6B6B').text(`Meal Timing: ${np.meal_timing}`);
      }
      if (np.hydration) {
        doc.fontSize(10).text(`Hydration: ${np.hydration}`);
      }
      if (np.supplements && np.supplements.length > 0) {
        doc.fontSize(10).text(`Supplements: ${np.supplements.join(', ')}`);
      }
      if (np.notes) {
        doc.moveDown(0.3);
        doc.fontSize(10).text(np.notes);
      }
    }

    if (program.coach_notes) {
      doc.moveDown(1);
      doc.fontSize(12).fillColor('#B8965A').text("MADDY'S NOTE");
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('#2C2C2C').text(program.coach_notes, { width: 500 });
    }

    const bottomY = doc.page.height - 40;
    doc.fontSize(8).fillColor('#C8B89A').text('fitnessbymaddy.com — Powered by Maddy\'s coaching system', 50, bottomY, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const targetWeek = week_no || 1;

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const program = await generateWithClaude(client, checkins || []);

    const safetyIssues = checkSafety(JSON.stringify(program));
    if (safetyIssues.length > 0) {
      await notifyMaddy(
        'Program safety flag',
        `Client: ${client.name || client.phone}\nWeek: ${targetWeek}\nFlags: ${safetyIssues.join(', ')}\n\nProgram held for review.`
      );
      return res.status(200).json({ ok: true, held: true, reason: 'safety_review', flags: safetyIssues });
    }

    const pdfBuffer = await generatePDF(program, client, targetWeek);

    const pdfPath = `${client.folder_url || 'clients/' + client.id}/week_${targetWeek}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) console.error('PDF upload error:', uploadErr.message);

    const { data: urlData } = await supabase.storage
      .from('clients')
      .createSignedUrl(pdfPath, 7 * 24 * 60 * 60);

    const pdfUrl = urlData?.signedUrl || null;

    const { data: saved } = await supabase.from('programs').upsert({
      client_id,
      week_no: targetWeek,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.coach_notes
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (pdfUrl) {
      const msg = `💪 Week ${targetWeek} program is ready!\n\n${program.coach_notes || ''}\n\nDownload your plan: ${pdfUrl}`;
      const sendResult = await sendText(client.phone, msg, true);
      if (sendResult.sent) {
        await supabase.from('programs').update({ whatsapp_sent_at: new Date().toISOString() }).eq('id', saved.id);
      }
    }

    return res.status(200).json({ ok: true, program_id: saved?.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
