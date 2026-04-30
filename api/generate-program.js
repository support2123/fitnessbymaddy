const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /very low calorie/i,
  /VLCD/i,
  /clenbuterol/i,
  /DNP/i,
  /ephedra/i,
  /anabolic/i,
  /steroid/i,
  /lose\s*\d+\s*kg\s*in\s*(1|2)\s*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .maybeSingle();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: previousProgram } = await db
    .from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  const claude = new Anthropic();

  const systemPrompt = `You are a NASM-certified fitness program architect working for FitnessByMaddy, an elite online coaching brand. Generate weekly workout and nutrition plans that are:
- Science-backed and progressive
- Tailored to the client's profile, goals, and recent check-in data
- Safe and sustainable (no extreme calorie cuts, no banned substances, realistic timelines)
- Written in a warm, expert tone

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "overview": "string",
    "days": [
      { "day": "Monday", "focus": "string", "exercises": [{ "name": "string", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "string" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "string"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["string"], "macros": "string" }
    ],
    "hydration": "string",
    "supplements": ["string"]
  },
  "context_note": "string (1-liner for WhatsApp)"
}`;

  const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Program: ${client.program}
- Injuries/limitations: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Flexible'}

${recentCheckins?.length ? `RECENT CHECK-INS:
${recentCheckins.map((c) => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No prior check-ins available.'}

${previousProgram ? `PREVIOUS WEEK PLAN SUMMARY:
Workout: ${JSON.stringify(previousProgram.workout_plan?.overview || '')}
Nutrition calories: ${previousProgram.nutrition_plan?.calories || 'N/A'}
Notes: ${previousProgram.notes || 'None'}` : 'This is the first week — create a foundational program.'}`;

  let programData;
  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  const fullOutput = JSON.stringify(programData);
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(fullOutput)) {
      const { createEscalation } = require('./_lib/escalation');
      await createEscalation(
        client.phone,
        `Unsafe program content detected: ${pattern.source}`,
        `Week ${week_no} program for client ${maskPhone(client.phone)} flagged`,
        client_id
      );
      return res.status(422).json({ error: 'Program flagged for safety review' });
    }
  }

  let pdfBuffer;
  try {
    pdfBuffer = await generatePDF(client, week_no, programData);
  } catch (err) {
    console.error('PDF generation error:', err.message);
    return res.status(500).json({ error: 'PDF generation failed' });
  }

  const pdfPath = `${client_id}/week_${week_no}.pdf`;
  const { error: uploadError } = await db.storage
    .from('clients')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    console.error('PDF upload error:', uploadError.message);
    return res.status(500).json({ error: 'PDF upload failed' });
  }

  const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || pdfPath;

  const { error: insertError } = await db.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.context_note || null,
  });

  if (insertError) {
    console.error('Program insert error:', insertError.message);
    return res.status(500).json({ error: 'Failed to save program' });
  }

  await sendTemplate(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no),
    programData.context_note || `Your Week ${week_no} plan is ready!`,
  ]);

  await db
    .from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ ok: true, pdf_url: pdfUrl, week_no });
};

function generatePDF(client, weekNo, data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 25);
    doc.fontSize(10).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 55);

    doc.moveDown(3);

    // Client info
    doc.fontSize(12).fill('#2C2C2C').text(`Client: ${client.name || 'Client'}`, 50);
    doc.text(`Program: ${client.program}`, 50);
    doc.text(`Week: ${weekNo}`, 50);
    doc.moveDown(1);

    // Divider
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(1);

    // Workout Plan
    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (data.workout_plan?.overview) {
      doc.fontSize(10).fill('#6B6B6B').text(data.workout_plan.overview, 50, undefined, { width: 495 });
      doc.moveDown(0.5);
    }

    if (data.workout_plan?.days) {
      for (const day of data.workout_plan.days) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(9).fill('#6B6B6B')
              .text(`  • ${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ` | ${ex.notes}` : ''}`, 60, undefined, { width: 485 });
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (data.workout_plan?.cardio) {
      doc.fontSize(10).fill('#2C2C2C').text('Cardio:', 50);
      doc.fontSize(9).fill('#6B6B6B').text(data.workout_plan.cardio, 60);
      doc.moveDown(0.5);
    }

    // New page for nutrition
    doc.addPage();
    doc.rect(0, 0, 595, 60).fill('#2C2C2C');
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, 20);

    doc.moveDown(3);

    if (data.nutrition_plan) {
      const np = data.nutrition_plan;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Targets: ${np.calories} cal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(12).fill('#2C2C2C').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill('#6B6B6B').text(`  • ${opt}`, 60, undefined, { width: 485 });
            }
          }
          if (meal.macros) {
            doc.fontSize(8).fill('#B8965A').text(`    ${meal.macros}`, 60);
          }
          doc.moveDown(0.3);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill('#2C2C2C').text('Hydration:', 50);
        doc.fontSize(9).fill('#6B6B6B').text(np.hydration, 60);
      }

      if (np.supplements?.length) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill('#2C2C2C').text('Supplements:', 50);
        for (const supp of np.supplements) {
          doc.fontSize(9).fill('#6B6B6B').text(`  • ${supp}`, 60);
        }
      }
    }

    // Footer
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);
    doc.fontSize(8).fill('#C8B89A').text('Generated by FitnessByMaddy | fitnessbymaddy.com', 50);
    doc.text('This plan is personalised — do not share or redistribute.', 50);

    doc.end();
  });
}
