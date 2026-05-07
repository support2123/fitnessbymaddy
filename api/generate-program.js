const { getClient } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .limit(1)
      .single();

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const programData = await generateWithClaude({
      client, checkins: checkins || [], intake, prevPrograms: prevPrograms || [], week_no,
    });

    if (!programData) {
      return res.status(500).json({ error: 'Program generation failed' });
    }

    const safetyCheck = checkSafety(JSON.stringify(programData));
    if (!safetyCheck.safe) {
      await notifyMaddy(
        `Safety flag: ${safetyCheck.reason}`,
        `Client ${maskPhone(client.phone)}, Week ${week_no}. Review before sending.`
      );
      await db.from('programs').insert({
        client_id, week_no,
        workout_plan: programData.workout,
        nutrition_plan: programData.nutrition,
        notes: `FLAGGED: ${safetyCheck.reason} — awaiting Maddy review`,
      });
      return res.status(200).json({ ok: true, flagged: true, reason: safetyCheck.reason });
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);

    const pdfPath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) console.error('PDF upload error:', uploadErr.message);

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData ? urlData.publicUrl : null;

    const { error: dbErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.coachNote || null,
      pdf_url: pdfUrl,
    });

    if (dbErr) throw dbErr;

    if (pdfUrl) {
      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_program',
        bodyValues: [
          client.name || 'there',
          `Week ${week_no}`,
          programData.coachNote || 'New program ready — let\'s go!',
        ],
        mediaUrl: pdfUrl,
      });

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generateWithClaude({ client, checkins, intake, prevPrograms, week_no }) {
  const anthropic = new Anthropic();

  const clientProfile = [
    `Name: ${client.name || 'Unknown'}`,
    `Program: ${client.program}`,
    `Week: ${week_no} of 12`,
    intake ? `Age: ${intake.age}, Gender: ${intake.gender}` : '',
    intake ? `Goal: ${intake.goal}` : '',
    intake ? `Injuries: ${intake.injuries || 'None reported'}` : '',
    intake ? `Diet: ${intake.diet_preference || 'No preference'}` : '',
    intake ? `Schedule: ${intake.schedule || 'Not specified'}` : '',
    intake ? `Weight: ${intake.current_weight}kg, Height: ${intake.height}cm` : '',
  ].filter(Boolean).join('\n');

  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`
  ).join('\n') || 'No prior check-ins available.';

  const prevProgramSummary = prevPrograms.length > 0
    ? `Previous week plan: ${JSON.stringify(prevPrograms[0].workout_plan).substring(0, 500)}`
    : 'No previous program data.';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: `You are a certified fitness program architect working for FitnessByMaddy.
Design evidence-based, safe programs. Never recommend extreme calorie deficits below 1200kcal for women or 1500kcal for men. Never recommend banned substances. Be progressive — adjust based on check-in data.
Output ONLY valid JSON with this structure:
{
  "workout": { "days": [{"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}]}] },
  "nutrition": { "calories": 1800, "protein_g": 140, "carbs_g": 200, "fat_g": 60, "meals": [{"meal": "Breakfast", "options": ["..."]}] },
  "coachNote": "One-liner context for the client"
}`,
    messages: [{
      role: 'user',
      content: `Generate Week ${week_no} program for this client:\n\n${clientProfile}\n\nRecent Check-ins:\n${checkinSummary}\n\n${prevProgramSummary}\n\nDesign a progressive, personalized week plan.`,
    }],
  });

  try {
    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error('Failed to parse Claude response');
    return null;
  }
}

function checkSafety(planText) {
  const lower = planText.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) {
      return { safe: false, reason: flag };
    }
  }
  return { safe: true };
}

async function generatePDF(programData, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const black = '#1a1a1a';
    const gold = '#B8965A';
    const grey = '#6B6B6B';

    doc.rect(0, 0, doc.page.width, 120).fill(black);
    doc.fill(gold).fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 40, 35, { characterSpacing: 3 });
    doc.fill('#ffffff').fontSize(14).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 40, 72);
    doc.fill('rgba(255,255,255,0.6)').fontSize(10)
      .text(`${client.name || 'Client'} | ${client.program.toUpperCase()}`, 40, 94);

    let y = 140;

    if (programData.coachNote) {
      doc.fill(gold).fontSize(10).font('Helvetica-Bold')
        .text('COACH\'S NOTE', 40, y);
      y += 16;
      doc.fill(grey).fontSize(10).font('Helvetica')
        .text(programData.coachNote, 40, y, { width: doc.page.width - 80 });
      y += 30;
    }

    if (programData.workout && programData.workout.days) {
      doc.fill(black).fontSize(16).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 40, y);
      y += 24;

      for (const day of programData.workout.days) {
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 40;
        }

        doc.fill(gold).fontSize(12).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus || ''}`, 40, y);
        y += 18;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > doc.page.height - 60) {
              doc.addPage();
              y = 40;
            }
            doc.fill(black).fontSize(10).font('Helvetica-Bold')
              .text(ex.name, 60, y);
            doc.fill(grey).fontSize(9).font('Helvetica')
              .text(`${ex.sets} sets x ${ex.reps} | Rest: ${ex.rest || '60s'}`, 60, y + 13);
            if (ex.notes) {
              doc.fill(grey).fontSize(8).font('Helvetica')
                .text(ex.notes, 60, y + 25, { width: doc.page.width - 120 });
              y += 38;
            } else {
              y += 30;
            }
          }
        }
        y += 10;
      }
    }

    if (programData.nutrition) {
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = 40;
      }

      doc.fill(black).fontSize(16).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 40, y);
      y += 24;

      const n = programData.nutrition;
      doc.fill(gold).fontSize(10).font('Helvetica-Bold')
        .text('DAILY TARGETS', 40, y);
      y += 16;
      doc.fill(grey).fontSize(10).font('Helvetica')
        .text(`Calories: ${n.calories || '—'} kcal  |  Protein: ${n.protein_g || '—'}g  |  Carbs: ${n.carbs_g || '—'}g  |  Fat: ${n.fat_g || '—'}g`, 40, y);
      y += 24;

      if (n.meals) {
        for (const meal of n.meals) {
          if (y > doc.page.height - 60) {
            doc.addPage();
            y = 40;
          }
          doc.fill(black).fontSize(10).font('Helvetica-Bold')
            .text(meal.meal, 60, y);
          y += 14;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill(grey).fontSize(9).font('Helvetica')
                .text(`• ${opt}`, 72, y, { width: doc.page.width - 130 });
              y += 14;
            }
          }
          y += 6;
        }
      }
    }

    const footerY = doc.page.height - 30;
    doc.fill(grey).fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | This program is for personal use only.', 40, footerY, { align: 'center', width: doc.page.width - 80 });

    doc.end();
  });
}
