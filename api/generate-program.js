const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');
const Anthropic = require('@anthropic-ai/sdk');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');

const SAFETY_FLAGS = [
  'below 1000 calories',
  'below 800 calories',
  'extreme',
  'clenbuterol',
  'dnp',
  'ephedra',
  'steroid',
  'sarm',
  'hgh',
  'testosterone',
  'crash diet',
  'water fast',
  'zero carb',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some((flag) => lower.includes(flag));
}

async function generateWithClaude(client, checkins, weekNo) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const lastTwoCheckins = checkins.slice(0, 2);
  const checkinSummary = lastTwoCheckins
    .map(
      (c) =>
        `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, ` +
        `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, ` +
        `Issues: ${c.issues || 'none'}`
    )
    .join('\n');

  const prompt = `You are an expert fitness program architect for Fitness by Maddy, a premium online coaching brand.

Create a detailed Week ${weekNo} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: 12-Week Custom Training
- Current week: ${weekNo} of 12

RECENT CHECK-INS:
${checkinSummary || 'No prior check-ins (Week 1)'}

INSTRUCTIONS:
1. Create a 7-day workout plan with exercises, sets, reps, rest periods
2. Create a daily nutrition plan with meals, macros, and calories
3. Include a brief coaching note (2-3 sentences, warm + expert tone)
4. Progressive overload from previous weeks where applicable
5. Account for any issues mentioned in check-ins

OUTPUT FORMAT (JSON only, no markdown):
{
  "coaching_note": "string",
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Push",
        "exercises": [
          {"name": "string", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "optional"}
        ]
      }
    ],
    "cardio": "string describing weekly cardio prescription",
    "rest_days": "string"
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "macros": {"protein_g": 150, "carbs_g": 200, "fat_g": 70},
    "meals": [
      {"meal": "Meal 1 - Breakfast", "items": ["item1", "item2"], "calories": 500}
    ],
    "hydration": "string",
    "supplements": ["optional"]
  }
}

SAFETY: Never prescribe below 1200 calories for women or 1500 for men. No banned substances. No extreme protocols. If unsure, err conservative.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse program JSON from Claude response');
  }

  return JSON.parse(jsonMatch[0]);
}

function generatePDF(client, weekNo, program) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(44, 44, 44);
  doc.rect(0, 0, pageWidth, 45, 'F');

  doc.setTextColor(184, 150, 90);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('FITNESS BY MADDY', pageWidth / 2, 18, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(`WEEK ${weekNo} PROGRAM`, pageWidth / 2, 30, { align: 'center' });

  doc.setFontSize(10);
  doc.setTextColor(212, 175, 122);
  doc.text(
    `${client.name || 'Client'} | 12-Week Custom Training`,
    pageWidth / 2,
    40,
    { align: 'center' }
  );

  let y = 55;

  if (program.coaching_note) {
    doc.setTextColor(107, 107, 107);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'italic');
    const noteLines = doc.splitTextToSize(program.coaching_note, pageWidth - 40);
    doc.text(noteLines, 20, y);
    y += noteLines.length * 6 + 10;
  }

  doc.setDrawColor(184, 150, 90);
  doc.line(20, y, pageWidth - 20, y);
  y += 10;

  doc.setTextColor(44, 44, 44);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('WORKOUT PLAN', 20, y);
  y += 10;

  if (program.workout_plan?.days) {
    for (const day of program.workout_plan.days) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(184, 150, 90);
      doc.text(day.day, 20, y);
      y += 8;

      if (day.exercises && day.exercises.length > 0) {
        const tableData = day.exercises.map((ex) => [
          ex.name,
          String(ex.sets),
          String(ex.reps),
          ex.rest || '-',
          ex.notes || '',
        ]);

        doc.autoTable({
          startY: y,
          head: [['Exercise', 'Sets', 'Reps', 'Rest', 'Notes']],
          body: tableData,
          margin: { left: 20, right: 20 },
          styles: {
            fontSize: 9,
            cellPadding: 3,
            textColor: [44, 44, 44],
          },
          headStyles: {
            fillColor: [44, 44, 44],
            textColor: [255, 255, 255],
            fontSize: 9,
            fontStyle: 'bold',
          },
          alternateRowStyles: { fillColor: [250, 248, 244] },
        });

        y = doc.lastAutoTable.finalY + 10;
      }
    }
  }

  if (program.workout_plan?.cardio) {
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(44, 44, 44);
    doc.text('Cardio:', 20, y);
    doc.setFont('helvetica', 'normal');
    doc.text(program.workout_plan.cardio, 50, y);
    y += 10;
  }

  doc.addPage();
  y = 20;

  doc.setFillColor(44, 44, 44);
  doc.rect(0, 0, pageWidth, 30, 'F');
  doc.setTextColor(184, 150, 90);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('NUTRITION PLAN', pageWidth / 2, 20, { align: 'center' });
  y = 40;

  if (program.nutrition_plan) {
    const np = program.nutrition_plan;

    doc.setTextColor(44, 44, 44);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Daily Targets', 20, y);
    y += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Calories: ${np.daily_calories} kcal`, 20, y);
    y += 6;

    if (np.macros) {
      doc.text(
        `Protein: ${np.macros.protein_g}g | Carbs: ${np.macros.carbs_g}g | Fat: ${np.macros.fat_g}g`,
        20,
        y
      );
      y += 10;
    }

    if (np.meals && np.meals.length > 0) {
      const mealData = np.meals.map((m) => [
        m.meal,
        m.items.join(', '),
        `${m.calories} kcal`,
      ]);

      doc.autoTable({
        startY: y,
        head: [['Meal', 'Items', 'Calories']],
        body: mealData,
        margin: { left: 20, right: 20 },
        styles: {
          fontSize: 9,
          cellPadding: 4,
          textColor: [44, 44, 44],
        },
        headStyles: {
          fillColor: [184, 150, 90],
          textColor: [255, 255, 255],
          fontSize: 9,
          fontStyle: 'bold',
        },
        alternateRowStyles: { fillColor: [250, 248, 244] },
        columnStyles: {
          1: { cellWidth: 80 },
        },
      });

      y = doc.lastAutoTable.finalY + 10;
    }

    if (np.hydration) {
      doc.setFont('helvetica', 'bold');
      doc.text('Hydration:', 20, y);
      doc.setFont('helvetica', 'normal');
      doc.text(np.hydration, 55, y);
      y += 8;
    }

    if (np.supplements && np.supplements.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Supplements:', 20, y);
      doc.setFont('helvetica', 'normal');
      doc.text(np.supplements.join(', '), 60, y);
    }
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      'FITNESS BY MADDY | fitnessbymaddy.com',
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  return Buffer.from(doc.output('arraybuffer'));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const program = await generateWithClaude(client, checkins || [], week_no);

    const programJson = JSON.stringify(program);
    if (hasSafetyIssue(programJson)) {
      await escalateToMaddy('Safety flag in generated program', {
        client_id,
        week_no,
        flag: 'Program contains potentially risky content',
      });
      return res.status(200).json({
        success: false,
        action: 'flagged_for_review',
        message: 'Program flagged for Maddy review due to safety concerns',
      });
    }

    const pdfBuffer = generatePDF(client, week_no, program);

    const fileName = `${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(fileName);

    const pdfUrl = urlData?.publicUrl || fileName;

    const { data: programRecord, error: insertErr } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: program.coaching_note,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Program record insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save program record' });
    }

    const contextNote = program.coaching_note
      ? program.coaching_note.slice(0, 150)
      : `Week ${week_no} program is ready!`;

    await sendWhatsApp(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(week_no), contextNote],
      pdfUrl
    );

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', programRecord.id);

    return res.status(200).json({
      success: true,
      program_id: programRecord.id,
      pdf_url: pdfUrl,
      week_no,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
