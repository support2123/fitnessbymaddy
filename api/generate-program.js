const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');

const SYSTEM_PROMPT = `You are a certified fitness program architect for FitnessByMaddy.
You design weekly workout and nutrition plans based on client data.

Rules:
- Never recommend extreme calorie cuts below 1200 kcal for women or 1500 for men
- Never recommend banned substances or supplements without evidence
- Never promise specific weight loss timelines
- Base recommendations on the client's check-in data, compliance, and energy levels
- Adjust intensity based on compliance score (1-10) and energy (1-10)
- Include warm-up and cool-down in every workout
- Provide practical, home-friendly alternatives where possible
- Use a progressive overload approach week to week

Output strict JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "hydration": "...",
    "supplements": "...",
    "weekly_notes": "..."
  },
  "coach_notes": "..."
}`;

module.exports = async function handler(req, res) {
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
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

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

    const clientContext = {
      name: client.name,
      program: client.program,
      week: week_no,
      recent_checkins: recentCheckins || [],
      previous_program: prevProgram || null,
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n${JSON.stringify(clientContext, null, 2)}`,
      }],
    });

    const responseText = message.content[0].text;
    let programData;

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Program generation failed — invalid format' });
    }

    const safetyFlags = checkSafety(programData);
    if (safetyFlags.length > 0) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: 'Risky program flagged',
        phone: client.phone,
        name: client.name,
        message: safetyFlags.join('; '),
        context: `Week ${week_no} program generation`,
      });
      return res.json({ ok: false, action: 'flagged_for_review', flags: safetyFlags });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr);
    }

    const { data: publicUrl } = db.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = publicUrl?.publicUrl || filePath;

    const { data: programRecord } = await db
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_notes || null,
      })
      .select()
      .single();

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [
        client.name || 'there',
        String(week_no),
        programData.coach_notes || 'New week, new gains! Check your updated plan.',
      ],
      mediaUrl: pdfUrl,
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', programRecord.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);

    return res.json({
      ok: true,
      program_id: programRecord.id,
      week_no,
      pdf_url: pdfUrl,
    });

  } catch (err) {
    console.error('Program generation error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function checkSafety(programData) {
  const flags = [];
  const np = programData.nutrition_plan;

  if (np && np.calories && np.calories < 1200) {
    flags.push(`Dangerously low calories: ${np.calories} kcal`);
  }

  const coachNotes = (programData.coach_notes || '').toLowerCase();
  const bannedTerms = ['steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra', 'hgh'];
  for (const term of bannedTerms) {
    if (coachNotes.includes(term)) {
      flags.push(`Banned substance reference: ${term}`);
    }
  }

  return flags;
}

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fillColor('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 72);
    doc.fillColor('#B8965A').fontSize(11)
      .text(`Prepared for ${client.name || 'Client'}`, 50, 92);

    doc.moveDown(3);

    const wp = programData.workout_plan;
    if (wp && wp.days) {
      doc.fillColor('#2C2C2C').fontSize(20).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);

      if (wp.weekly_notes) {
        doc.fillColor('#6B6B6B').fontSize(10).font('Helvetica')
          .text(wp.weekly_notes, 50, doc.y, { width: 500 });
        doc.moveDown(0.8);
      }

      for (const day of wp.days) {
        if (doc.y > 680) doc.addPage();

        doc.rect(50, doc.y, 500, 24).fill('#F0EAE0');
        doc.fillColor('#2C2C2C').fontSize(12).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 60, doc.y + 6);
        doc.moveDown(1.5);

        if (day.warmup) {
          doc.fillColor('#B8965A').fontSize(9).font('Helvetica-Bold')
            .text('Warm-up: ', 60, doc.y, { continued: true });
          doc.fillColor('#6B6B6B').font('Helvetica').text(day.warmup);
          doc.moveDown(0.3);
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
              .text(`  •  ${ex.name}  —  ${ex.sets}x${ex.reps}  (Rest: ${ex.rest})`, 60, doc.y, { width: 480 });
            if (ex.notes) {
              doc.fillColor('#6B6B6B').fontSize(8)
                .text(`     ${ex.notes}`, 70, doc.y, { width: 460 });
            }
            doc.moveDown(0.2);
          }
        }

        if (day.cooldown) {
          doc.fillColor('#B8965A').fontSize(9).font('Helvetica-Bold')
            .text('Cool-down: ', 60, doc.y, { continued: true });
          doc.fillColor('#6B6B6B').font('Helvetica').text(day.cooldown);
        }

        doc.moveDown(0.8);
      }
    }

    if (doc.y > 500) doc.addPage();

    const np = programData.nutrition_plan;
    if (np) {
      doc.fillColor('#2C2C2C').fontSize(20).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);

      doc.rect(50, doc.y, 500, 40).fill('#F0EAE0');
      const macroY = doc.y + 10;
      doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica-Bold');
      doc.text(`Calories: ${np.calories || '-'}`, 60, macroY);
      doc.text(`Protein: ${np.protein_g || '-'}g`, 200, macroY);
      doc.text(`Carbs: ${np.carbs_g || '-'}g`, 330, macroY);
      doc.text(`Fat: ${np.fat_g || '-'}g`, 450, macroY);
      doc.moveDown(2.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fillColor('#B8965A').fontSize(11).font('Helvetica-Bold')
            .text(meal.meal, 60, doc.y);
          doc.moveDown(0.3);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fillColor('#2C2C2C').fontSize(9).font('Helvetica')
                .text(`  •  ${opt}`, 70, doc.y, { width: 460 });
              doc.moveDown(0.2);
            }
          }
          doc.moveDown(0.4);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fillColor('#B8965A').fontSize(9).font('Helvetica-Bold')
          .text('Hydration: ', 60, doc.y, { continued: true });
        doc.fillColor('#6B6B6B').font('Helvetica').text(np.hydration);
      }
    }

    const bottomY = doc.page.height - 40;
    doc.fillColor('#C8B89A').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | This program is personalised — do not share.', 50, bottomY, {
        width: 500, align: 'center',
      });

    doc.end();
  });
}
