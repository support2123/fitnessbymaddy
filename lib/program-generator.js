const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

async function generateWeeklyProgram(clientId, weekNo) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (!client) throw new Error(`Client ${clientId} not found`);

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const anthropic = new Anthropic();

  const systemPrompt = `You are a NASM-certified fitness program architect working for Fitness by Maddy, an elite online coaching brand. You create safe, science-backed, personalised weekly workout and nutrition plans.

RULES:
- Never prescribe extreme calorie cuts below 1200 kcal for women or 1500 for men
- Never recommend banned or unregulated supplements
- Never set unrealistic timelines (e.g. "lose 10kg in 1 week")
- If the client reports pain or injury, flag for human review instead of programming around it
- Always include rest days and deload guidance
- Adjust based on compliance score and energy from check-ins

Output valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }] },
      ...
    ],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meal_timing": "...",
    "hydration": "...",
    "supplements": ["..."],
    "notes": "..."
  },
  "coach_notes": "...",
  "flagged_for_review": false
}`;

  const checkinSummary = recentCheckins && recentCheckins.length > 0
    ? recentCheckins.map(c =>
      `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    ).join('\n')
    : 'No previous check-ins available (first week).';

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Generate Week ${weekNo} program for this client:

Name: ${client.name}
Program: ${client.program}
Age: ${client.age || 'unknown'}
Goal: ${client.goal || 'general fitness'}
Injuries/limitations: ${client.injuries || 'none reported'}
Diet preference: ${client.diet_pref || 'no preference'}
Schedule: ${client.schedule || 'flexible'}

Recent check-ins:
${checkinSummary}

Generate the weekly program JSON.`,
    }],
  });

  const responseText = msg.content[0].text;
  let programData;
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    programData = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Failed to parse program JSON from Claude response');
  }

  if (programData.flagged_for_review) {
    return { flagged: true, data: programData };
  }

  const pdfBuffer = await buildPDF(client, weekNo, programData);

  const fileName = `clients/${clientId}/week_${weekNo}.pdf`;
  const { error: uploadErr } = await db.storage
    .from('programs')
    .upload(fileName, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadErr) throw new Error(`PDF upload failed: ${uploadErr.message}`);

  const { data: urlData } = db.storage.from('programs').getPublicUrl(fileName);

  await db.from('programs').insert({
    client_id: clientId,
    week_no: weekNo,
    pdf_url: urlData.publicUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.coach_notes,
  });

  return { flagged: false, pdfUrl: urlData.publicUrl, data: programData };
}

function buildPDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 80).fill('#2C2C2C');
    doc.fillColor('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { align: 'left' });
    doc.fillColor('#FFFFFF').fontSize(12).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { align: 'left' });
    doc.fillColor('#FFFFFF').fontSize(10)
      .text(client.name || '', 400, 35, { align: 'right' });

    doc.moveDown(3);

    // Workout section
    doc.fillColor('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (program.workout_plan && program.workout_plan.days) {
      for (const day of program.workout_plan.days) {
        doc.fillColor('#B8965A').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60);
            if (ex.notes) {
              doc.fillColor('#6B6B6B').fontSize(9)
                .text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (program.workout_plan && program.workout_plan.weekly_notes) {
      doc.moveDown(0.5);
      doc.fillColor('#6B6B6B').fontSize(10).font('Helvetica-Oblique')
        .text(program.workout_plan.weekly_notes, 50, undefined, { width: 495 });
    }

    // Nutrition section
    doc.addPage();
    doc.rect(0, 0, 595, 60).fill('#2C2C2C');
    doc.fillColor('#B8965A').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 20);

    doc.moveDown(3);

    if (program.nutrition_plan) {
      const np = program.nutrition_plan;
      doc.fillColor('#2C2C2C').fontSize(12).font('Helvetica-Bold')
        .text('Daily Targets', 50);
      doc.moveDown(0.3);
      doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
        .text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 60);

      if (np.meal_timing) {
        doc.moveDown(0.8);
        doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold').text('Meal Timing', 50);
        doc.moveDown(0.3);
        doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
          .text(np.meal_timing, 60, undefined, { width: 480 });
      }

      if (np.hydration) {
        doc.moveDown(0.8);
        doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold').text('Hydration', 50);
        doc.moveDown(0.3);
        doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
          .text(np.hydration, 60, undefined, { width: 480 });
      }

      if (np.supplements && np.supplements.length) {
        doc.moveDown(0.8);
        doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold').text('Supplements', 50);
        doc.moveDown(0.3);
        for (const s of np.supplements) {
          doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica').text(`  • ${s}`, 60);
        }
      }

      if (np.notes) {
        doc.moveDown(0.8);
        doc.fillColor('#6B6B6B').fontSize(10).font('Helvetica-Oblique')
          .text(np.notes, 50, undefined, { width: 495 });
      }
    }

    // Coach notes
    if (program.coach_notes) {
      doc.moveDown(1.5);
      doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold').text("Coach's Notes", 50);
      doc.moveDown(0.3);
      doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
        .text(program.coach_notes, 50, undefined, { width: 495 });
    }

    // Footer
    doc.moveDown(2);
    doc.fillColor('#C8B89A').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | This program is personalised — do not share.', 50, undefined, { align: 'center' });

    doc.end();
  });
}

module.exports = { generateWeeklyProgram };
