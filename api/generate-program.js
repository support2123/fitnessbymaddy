const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*(10|15|20)\+?\s*kg.*week/i,
  /extreme\s*cut/i,
];

function flagRiskyContent(text) {
  for (const pattern of RISKY_PATTERNS) {
    if (pattern.test(text)) return pattern.source;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
Design a week of training and nutrition for a real client.
Output valid JSON only with two keys: "workout_plan" and "nutrition_plan".

workout_plan: Array of 7 day objects, each with:
  - day (string: "Monday" etc.)
  - focus (string: muscle group or "Rest")
  - exercises: array of { name, sets, reps, rest_seconds, notes }

nutrition_plan: Object with:
  - daily_calories (number)
  - protein_g, carbs_g, fat_g (numbers)
  - meals: array of { meal_name, time, foods: string[], calories }
  - notes (string)

Rules:
- Be evidence-based. No bro-science.
- Never prescribe under 1300 calories for women or 1500 for men.
- Never suggest banned substances.
- Adapt based on check-in data (compliance, energy, weight trend).
- If client reports pain or issues, reduce load on affected areas.`;

    const userPrompt = `Client: ${client.name || 'Client'}
Program: ${client.program}
Week: ${week_no} of 12

${recentCheckins && recentCheckins.length > 0
  ? `Recent check-ins:\n${JSON.stringify(recentCheckins, null, 2)}`
  : 'No check-in data yet (Week 1).'}

${prevProgram
  ? `Previous week plan notes: ${prevProgram.notes || 'None'}`
  : 'First week — build a solid foundation program.'}

Generate Week ${week_no} program as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      system: systemPrompt,
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON from Claude' });
    }

    let programData;
    try {
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Invalid JSON from Claude' });
    }

    const riskyFlag = flagRiskyContent(rawText);
    if (riskyFlag) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation(
        client.phone,
        `Risky program content flagged: ${riskyFlag}`,
        `Week ${week_no} program for client ${client_id}`
      );
      return res.status(200).json({
        action: 'flagged_for_review',
        reason: riskyFlag,
      });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = db.storage.from('programs').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: `Generated for Week ${week_no}`,
    });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      pdfUrl,
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({
      success: true,
      client_id,
      week_no,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fill('#FFFFFF').fontSize(14).text(`Week ${weekNo} Program`, 50, 75, { align: 'left' });
    doc.fill('#FFFFFF').fontSize(10).text(client.name || 'Client', 50, 95, { align: 'left' });

    doc.fill('#2C2C2C');
    let y = 150;

    if (programData.workout_plan) {
      doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of programData.workout_plan) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }

        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises && Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            if (y > 720) {
              doc.addPage();
              y = 50;
            }
            const line = `  ${ex.name}: ${ex.sets}x${ex.reps} (${ex.rest_seconds || 60}s rest)`;
            doc.fontSize(10).fill('#6B6B6B').text(line, 60, y);
            y += 15;
            if (ex.notes) {
              doc.fontSize(8).fill('#999').text(`    ${ex.notes}`, 70, y);
              y += 12;
            }
          }
        }
        y += 10;
      }
    }

    if (programData.nutrition_plan) {
      if (y > 550) {
        doc.addPage();
        y = 50;
      }

      doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = programData.nutrition_plan;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Target: ${np.daily_calories} cal | P: ${np.protein_g}g | C: ${np.carbs_g}g | F: ${np.fat_g}g`, 50, y);
      y += 25;

      if (np.meals && Array.isArray(np.meals)) {
        for (const meal of np.meals) {
          if (y > 700) {
            doc.addPage();
            y = 50;
          }
          doc.fontSize(12).fill('#2C2C2C').text(`${meal.meal_name} (${meal.time}) — ${meal.calories} cal`, 50, y);
          y += 18;
          if (meal.foods && Array.isArray(meal.foods)) {
            for (const food of meal.foods) {
              doc.fontSize(9).fill('#6B6B6B').text(`  • ${food}`, 60, y);
              y += 13;
            }
          }
          y += 8;
        }
      }

      if (np.notes) {
        if (y > 680) {
          doc.addPage();
          y = 50;
        }
        doc.fontSize(10).fill('#999').text(`Notes: ${np.notes}`, 50, y);
      }
    }

    const lastPage = doc.bufferedPageRange();
    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(8)
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 28);

    doc.end();
  });
}
