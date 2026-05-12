const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const BANNED_KEYWORDS = [
  'steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra', 'hgh',
  'testosterone inject', 'anavar', 'trenbolone', 'dianabol',
  'anadrol', 'winstrol', 'deca-durabolin', 'stanozolol',
];

const BRAND_GOLD = [184, 150, 90]; // #B8965A

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { client_id, week_no } = req.body || {};

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const supabase = getSupabase();

  try {
    // ─── 1. Fetch client ────────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // ─── 2. Fetch last 2 check-ins ──────────────────
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // ─── 3. Fetch previous programs for context ─────
    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // ─── 4. Build Claude prompt ─────────────────────
    const systemPrompt = `You are a NASM-certified personal trainer and nutrition coach. Generate a week-by-week personalized program. Output ONLY valid JSON — no markdown, no explanation, no code fences.

The output must follow this exact schema:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + band pull-aparts",
        "cooldown": "5 min stretching"
      }
    ],
    "notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "macros": { "protein_g": 150, "carbs_g": 200, "fat_g": 67 },
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "items": ["..."], "calories": 500 }
    ],
    "notes": "..."
  },
  "weekly_notes": "..."
}`;

    const checkinContext = checkins && checkins.length > 0
      ? checkins.map((c) => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}", focus="${c.next_week_focus || 'none'}"`).join('\n')
      : 'No check-in data yet (first week).';

    const prevProgramContext = prevPrograms && prevPrograms.length > 0
      ? prevPrograms.map((p) => `Week ${p.week_no}: ${JSON.stringify(p.workout_plan)}`).join('\n')
      : 'No previous programs (first week).';

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name}
- Age: ${client.age || 'not provided'}
- Goal: ${client.goal || 'general fitness'}
- Injuries/limitations: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'no preference'}
- Schedule availability: ${client.schedule || 'flexible'}
- Program type: ${client.program || 'general'}

RECENT CHECK-IN DATA:
${checkinContext}

PREVIOUS PROGRAM (for continuity):
${prevProgramContext}

Generate a progressive, safe, and effective Week ${week_no} program. Ensure calorie targets are reasonable (minimum 1200 for women, 1500 for men). Adjust intensity based on compliance and energy scores.`;

    // ─── 5. Call Claude API ─────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text.trim();

    // ─── 6. Parse JSON response ─────────────────────
    let program;
    try {
      // Strip possible markdown fences if the model added them
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      program = JSON.parse(cleaned);
    } catch (parseErr) {
      return res.status(500).json({
        error: 'Failed to parse program JSON from AI response',
        raw: rawText.substring(0, 500),
      });
    }

    // ─── 7. Safety checks ───────────────────────────
    const programStr = JSON.stringify(program).toLowerCase();

    // Check for banned substances
    const foundBanned = BANNED_KEYWORDS.filter((kw) => programStr.includes(kw));
    if (foundBanned.length > 0) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        client_id: client.id,
        reason: 'banned_substance_in_program',
        message_body: `Week ${week_no} program contained banned keywords: ${foundBanned.join(', ')}`,
        resolved: false,
      });
      return res.status(400).json({
        error: 'Program rejected — flagged content detected',
        flagged: foundBanned,
      });
    }

    // Check minimum calories
    const calories = program.nutrition_plan && program.nutrition_plan.daily_calories;
    if (calories && calories < 1200) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        client_id: client.id,
        reason: 'unsafe_calorie_target',
        message_body: `Week ${week_no} program had only ${calories} calories (minimum 1200)`,
        resolved: false,
      });
      return res.status(400).json({
        error: 'Program rejected — calorie target too low',
        calories,
      });
    }

    // ─── 8. Store in programs table ─────────────────
    const { data: programRow, error: insertErr } = await supabase
      .from('programs')
      .insert({
        client_id: client.id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: program.weekly_notes || null,
      })
      .select('id')
      .single();

    if (insertErr) {
      throw new Error(`Failed to store program: ${insertErr.message}`);
    }

    // ─── 9. Generate PDF ────────────────────────────
    const pdfBuffer = await generatePDF(client, week_no, program);

    // ─── 10. Upload PDF to Supabase Storage ─────────
    const storagePath = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Failed to upload PDF: ${uploadErr.message}`);
    }

    // Get the public URL for the PDF
    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData.publicUrl;

    // ─── 11. Update programs record with pdf_url ────
    await supabase
      .from('programs')
      .update({ pdf_url: pdfUrl })
      .eq('id', programRow.id);

    // ─── 12. Send via WhatsApp ──────────────────────
    const summaryLine = program.weekly_notes
      ? program.weekly_notes.substring(0, 120)
      : `Your Week ${week_no} program is ready!`;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      summaryLine,
      pdfUrl,
    ]);

    // ─── 13. Update whatsapp_sent_at ────────────────
    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', programRow.id);

    return res.status(200).json({
      success: true,
      program_id: programRow.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── PDF Generation ───────────────────────────────────

function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const marginLeft = 50;
    const contentWidth = pageWidth - marginLeft * 2;

    // ─── Header ─────────────────────────
    doc.rect(0, 0, pageWidth, 100).fill('#000000');
    doc
      .font('Helvetica-Bold')
      .fontSize(22)
      .fillColor(BRAND_GOLD)
      .text(`Week ${weekNo} Program`, marginLeft, 25, {
        width: contentWidth,
        align: 'center',
      });
    doc
      .font('Helvetica')
      .fontSize(14)
      .fillColor('#FFFFFF')
      .text(client.name || 'Client', marginLeft, 55, {
        width: contentWidth,
        align: 'center',
      });

    doc.moveDown(2);
    doc.y = 120;

    // ─── Workout Plan Section ───────────
    doc.fillColor('#000000');
    sectionHeader(doc, 'WORKOUT PLAN', marginLeft, contentWidth);

    if (program.workout_plan && program.workout_plan.days) {
      for (const day of program.workout_plan.days) {
        checkPageSpace(doc, 150);

        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .fillColor(BRAND_GOLD)
          .text(`${day.day} — ${day.focus || ''}`, marginLeft);

        if (day.warmup) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#555555')
            .text(`Warm-up: ${day.warmup}`, marginLeft + 10);
        }

        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            checkPageSpace(doc, 20);
            const detail = [
              ex.name,
              ex.sets ? `${ex.sets} sets` : null,
              ex.reps ? `x ${ex.reps}` : null,
              ex.rest ? `(rest ${ex.rest})` : null,
              ex.notes ? `— ${ex.notes}` : null,
            ]
              .filter(Boolean)
              .join('  ');

            doc
              .font('Helvetica')
              .fontSize(10)
              .fillColor('#000000')
              .text(`  •  ${detail}`, marginLeft + 10, undefined, {
                width: contentWidth - 20,
              });
          }
        }

        if (day.cooldown) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#555555')
            .text(`Cool-down: ${day.cooldown}`, marginLeft + 10);
        }

        doc.moveDown(0.8);
      }
    }

    if (program.workout_plan && program.workout_plan.notes) {
      checkPageSpace(doc, 40);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#333333')
        .text(`Notes: ${program.workout_plan.notes}`, marginLeft, undefined, {
          width: contentWidth,
        });
      doc.moveDown(1);
    }

    // ─── Nutrition Plan Section ─────────
    checkPageSpace(doc, 100);
    sectionHeader(doc, 'NUTRITION PLAN', marginLeft, contentWidth);

    if (program.nutrition_plan) {
      const np = program.nutrition_plan;

      if (np.daily_calories || np.macros) {
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor('#000000');

        const macroLine = [
          np.daily_calories ? `${np.daily_calories} kcal/day` : null,
          np.macros
            ? `P: ${np.macros.protein_g}g | C: ${np.macros.carbs_g}g | F: ${np.macros.fat_g}g`
            : null,
        ]
          .filter(Boolean)
          .join('  —  ');

        doc.text(macroLine, marginLeft);
        doc.moveDown(0.5);
      }

      if (np.meals) {
        for (const meal of np.meals) {
          checkPageSpace(doc, 40);

          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(BRAND_GOLD)
            .text(
              `${meal.meal}${meal.time ? ` (${meal.time})` : ''}${meal.calories ? ` — ${meal.calories} kcal` : ''}`,
              marginLeft
            );

          if (meal.items && meal.items.length > 0) {
            doc
              .font('Helvetica')
              .fontSize(10)
              .fillColor('#000000')
              .text(`  ${meal.items.join(', ')}`, marginLeft + 10, undefined, {
                width: contentWidth - 20,
              });
          }

          doc.moveDown(0.4);
        }
      }

      if (np.notes) {
        checkPageSpace(doc, 40);
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#333333')
          .text(`Notes: ${np.notes}`, marginLeft, undefined, {
            width: contentWidth,
          });
      }
    }

    // ─── Weekly Notes ───────────────────
    if (program.weekly_notes) {
      checkPageSpace(doc, 60);
      doc.moveDown(1);
      sectionHeader(doc, 'WEEKLY NOTES', marginLeft, contentWidth);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#333333')
        .text(program.weekly_notes, marginLeft, undefined, {
          width: contentWidth,
        });
    }

    // ─── Footer ─────────────────────────
    const footerY = doc.page.height - 40;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#999999')
      .text('Fitness by Maddy  |  fitnessbymaddy.com', marginLeft, footerY, {
        width: contentWidth,
        align: 'center',
      });

    doc.end();
  });
}

function sectionHeader(doc, title, x, width) {
  const y = doc.y;
  doc.rect(x, y, width, 24).fill('#000000');
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(BRAND_GOLD)
    .text(title, x + 10, y + 6, { width: width - 20 });
  doc.y = y + 32;
  doc.fillColor('#000000');
}

function checkPageSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - 60) {
    doc.addPage();
    doc.y = 50;
  }
}
