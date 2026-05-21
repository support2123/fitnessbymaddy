const { getSupabase } = require('./lib/supabase');
const { sendTemplateForced, maskPhone } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/notify-maddy');

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'under 1000', 'below 800',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for weight loss'
];

function checkProgramSafety(plan) {
  const text = JSON.stringify(plan).toLowerCase();
  return SAFETY_FLAGS.filter(flag => text.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(200).json({ ok: true, message: 'Program already exists', id: existingProgram.id });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const Anthropic = require('@anthropic-ai/sdk');
    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect working for FitnessByMaddy.
You design weekly workout and nutrition plans for clients in their 12-week custom program.

Rules:
- Be evidence-based. No bro-science.
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men).
- Never recommend banned or dangerous substances.
- Progressive overload: increase intensity/volume gradually.
- Account for client's reported issues, energy levels, and compliance.
- Output valid JSON only. No markdown, no explanations outside the JSON.`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at || 'recently'}

${recentCheckins && recentCheckins.length > 0 ? `Recent Check-ins:
${recentCheckins.map(c => `  Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No previous check-ins yet (Week 1).'}

${lastProgram ? `Last Week's Program Summary:
${lastProgram.notes || 'Standard program'}` : 'First week - build foundation program.'}

Return this exact JSON structure:
{
  "workout_plan": {
    "overview": "Brief week overview",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "warmup": "5 min dynamic stretching",
        "exercises": [
          { "name": "Exercise name", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ],
        "cooldown": "5 min stretching"
      }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "frequency": "3x/week", "type": "LISS or HIIT", "duration": "20-30 min" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"], "macros": "P:40g C:50g F:15g" }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": "Any special dietary notes"
  },
  "notes": "Coach notes about this week's focus and adjustments"
}`;

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    let programData;
    const responseText = response.content[0].text;

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      await notifyMaddy(
        `Program generation parse error for ${client.name || maskPhone(client.phone)}`,
        `Week ${week_no}. Claude returned invalid JSON. Manual review needed.`
      );
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const safetyIssues = checkProgramSafety(programData);
    if (safetyIssues.length > 0) {
      await notifyMaddy(
        `SAFETY FLAG: Program for ${client.name || maskPhone(client.phone)}`,
        `Week ${week_no} flagged for: ${safetyIssues.join(', ')}. Program NOT sent. Review required.`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || {},
        nutrition_plan: programData.nutrition_plan || {},
        notes: `FLAGGED FOR REVIEW: ${safetyIssues.join(', ')}. ${programData.notes || ''}`
      });

      return res.status(200).json({ ok: true, flagged: true, reasons: safetyIssues });
    }

    let pdfUrl = null;
    try {
      const PDFDocument = require('pdfkit');
      const pdfBuffer = await generatePDF(PDFDocument, client, week_no, programData);

      const filePath = `${client_id}/week_${week_no}.pdf`;
      const { error: uploadErr } = await db.storage
        .from('clients')
        .upload(filePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (!uploadErr) {
        const { data: urlData } = db.storage
          .from('clients')
          .getPublicUrl(filePath);
        pdfUrl = urlData?.publicUrl || null;
      }
    } catch (pdfErr) {
      console.error('PDF generation failed:', pdfErr.message);
    }

    const { data: savedProgram } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan || {},
      nutrition_plan: programData.nutrition_plan || {},
      notes: programData.notes || '',
      pdf_url: pdfUrl
    }).select('id').single();

    if (pdfUrl) {
      await sendTemplateForced(client.phone, 'weekly_program', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(week_no),
          programData.notes || `Your Week ${week_no} program is ready!`
        ],
        media: {
          url: pdfUrl,
          filename: `Week_${week_no}_Program.pdf`
        }
      });

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', savedProgram.id);
    }

    return res.status(200).json({
      ok: true,
      program_id: savedProgram?.id,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(PDFDocument, client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const GOLD = '#B8965A';
    const CHARCOAL = '#2C2C2C';
    const GREY = '#6B6B6B';

    doc.rect(0, 0, doc.page.width, 120).fill(CHARCOAL);
    doc.fontSize(28).fill('#FFFFFF')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 4 });
    doc.fontSize(14).fill(GOLD)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { characterSpacing: 2 });
    doc.fontSize(10).fill('#AAAAAA')
      .text(`Prepared for ${client.name || 'Client'} | ${new Date().toLocaleDateString('en-IN')}`, 50, 97);

    let y = 145;

    const wp = programData.workout_plan;
    if (wp) {
      doc.fontSize(18).fill(GOLD).text('WORKOUT PLAN', 50, y, { characterSpacing: 2 });
      y += 30;

      if (wp.overview) {
        doc.fontSize(10).fill(GREY).text(wp.overview, 50, y, { width: 500 });
        y += doc.heightOfString(wp.overview, { width: 500 }) + 15;
      }

      if (wp.days) {
        for (const day of wp.days) {
          if (y > 700) { doc.addPage(); y = 50; }

          doc.rect(50, y, 500, 22).fill('#F5F0E8');
          doc.fontSize(11).fill(CHARCOAL)
            .text(`${day.day} — ${day.focus}`, 58, y + 5, { characterSpacing: 1 });
          y += 30;

          if (day.exercises) {
            for (const ex of day.exercises) {
              if (y > 720) { doc.addPage(); y = 50; }
              doc.fontSize(9).fill(CHARCOAL)
                .text(`  ${ex.name}`, 60, y)
                .fill(GREY)
                .text(`${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 300, y);
              if (ex.notes) {
                y += 13;
                doc.fontSize(8).fill(GREY).text(`    ${ex.notes}`, 60, y);
              }
              y += 15;
            }
          }
          y += 10;
        }
      }

      if (wp.cardio) {
        if (y > 680) { doc.addPage(); y = 50; }
        y += 5;
        doc.fontSize(10).fill(GOLD).text('CARDIO', 50, y, { characterSpacing: 1 });
        y += 16;
        doc.fontSize(9).fill(GREY)
          .text(`${wp.cardio.frequency} | ${wp.cardio.type} | ${wp.cardio.duration}`, 60, y);
        y += 25;
      }
    }

    const np = programData.nutrition_plan;
    if (np) {
      if (y > 580) { doc.addPage(); y = 50; }
      doc.fontSize(18).fill(GOLD).text('NUTRITION PLAN', 50, y, { characterSpacing: 2 });
      y += 30;

      doc.rect(50, y, 500, 35).fill('#F5F0E8');
      doc.fontSize(10).fill(CHARCOAL)
        .text(`Calories: ${np.calories || '—'} kcal   |   Protein: ${np.protein_g || '—'}g   |   Carbs: ${np.carbs_g || '—'}g   |   Fats: ${np.fats_g || '—'}g`, 58, y + 10);
      y += 50;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill(CHARCOAL).text(meal.meal, 60, y);
          y += 14;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill(GREY).text(`  → ${opt}`, 70, y);
              y += 13;
            }
          }
          if (meal.macros) {
            doc.fontSize(8).fill(GOLD).text(`    ${meal.macros}`, 70, y);
            y += 13;
          }
          y += 6;
        }
      }

      if (np.supplements && np.supplements.length > 0) {
        if (y > 700) { doc.addPage(); y = 50; }
        y += 5;
        doc.fontSize(10).fill(GOLD).text('SUPPLEMENTS', 50, y, { characterSpacing: 1 });
        y += 16;
        doc.fontSize(9).fill(GREY).text(np.supplements.join('  |  '), 60, y);
        y += 20;
      }
    }

    if (programData.notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 10;
      doc.fontSize(10).fill(GOLD).text('COACH NOTES', 50, y, { characterSpacing: 1 });
      y += 16;
      doc.fontSize(9).fill(GREY).text(programData.notes, 60, y, { width: 480 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#CCCCCC')
        .text(
          'fitnessbymaddy.com | Confidential — for personal use only',
          50, doc.page.height - 40, { align: 'center', width: 500 }
        );
    }

    doc.end();
  });
}
