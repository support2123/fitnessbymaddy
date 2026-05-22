const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, corsHeaders } = require('./_lib/utils');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  if (corsHeaders(req, res)) return;
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

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for Fitness by Maddy.
Generate a weekly workout + nutrition plan in JSON format.

Rules:
- Science-backed, progressive overload principles
- Never recommend extreme calorie cuts (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Never promise specific timeline results
- Adjust based on check-in data (compliance, energy, issues)
- Include warm-up and cooldown in every session
- Nutrition should be practical and culturally appropriate

Output strict JSON with two keys: "workout_plan" and "nutrition_plan".
workout_plan: { days: [{ day: "Monday", focus: "...", exercises: [{ name, sets, reps, rest, notes }], warmup: "...", cooldown: "..." }] }
nutrition_plan: { daily_calories: number, protein_g: number, carbs_g: number, fat_g: number, meals: [{ meal: "Breakfast", options: ["..."] }], hydration: "...", supplements: ["..."] }`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${client.goal || 'General fitness'}
- Injuries/limitations: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No restrictions'}
- Schedule availability: ${client.schedule || 'Flexible'}
- Age: ${client.age || 'Not specified'}

Recent check-ins:
${recentCheckins?.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : 'No previous check-ins (Week 1)'}

Previous program notes: ${prevProgram?.notes || 'None (first week)'}

Return ONLY valid JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response');
      await notifyMaddy(
        'Program generation parse error',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}`
      );
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const safetyIssues = checkSafety(programData);
    if (safetyIssues.length > 0) {
      await notifyMaddy(
        'Program safety flag',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nIssues: ${safetyIssues.join(', ')}`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: `FLAGGED: ${safetyIssues.join(', ')}`,
      });
      return res.status(200).json({ success: true, flagged: true, issues: safetyIssues });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client_id}/${fileName}`;

    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) console.error('PDF upload error:', uploadErr.message);

    const { data: urlData } = db.storage.from('programs').getPublicUrl(storagePath);
    const pdfUrl = urlData?.publicUrl || storagePath;

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        pdf_url: pdfUrl,
        notes: `Auto-generated Week ${week_no}`,
      })
      .select()
      .single();

    await sendWhatsApp({
      phone: client.phone,
      message: `Hey ${client.name || 'there'}! 🔥 Your Week ${week_no} program is ready!\n\nCheck your personalized workout + nutrition plan here: ${pdfUrl}\n\nLet's crush it this week! 💪`,
    });

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function checkSafety(programData) {
  const issues = [];
  const np = programData.nutrition_plan;
  if (np?.daily_calories && np.daily_calories < 1200) {
    issues.push(`Calories too low: ${np.daily_calories}`);
  }
  if (np?.supplements) {
    const banned = ['steroids', 'sarms', 'clenbuterol', 'dnp', 'ephedra'];
    for (const s of np.supplements) {
      if (banned.some(b => s.toLowerCase().includes(b))) {
        issues.push(`Banned substance: ${s}`);
      }
    }
  }
  return issues;
}

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 70, { align: 'center' });
    doc.fill('#D4AF7A').fontSize(11)
      .text(`${client.name || 'Client'} | ${client.program?.toUpperCase()}`, 50, 92, { align: 'center' });

    doc.moveDown(3);

    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const wp = programData.workout_plan;
    if (wp?.days) {
      for (const day of wp.days) {
        doc.fill('#B8965A').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`);
        if (day.warmup) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Warm-up: ${day.warmup}`);
        }
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
              .text(`  ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, {
                continued: false,
              });
            if (ex.notes) {
              doc.fill('#6B6B6B').fontSize(8).text(`    ${ex.notes}`);
            }
          }
        }
        if (day.cooldown) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Cool-down: ${day.cooldown}`);
        }
        doc.moveDown(0.5);

        if (doc.y > 700) doc.addPage();
      }
    }

    if (doc.y > 500) doc.addPage();

    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const np = programData.nutrition_plan;
    if (np) {
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold')
        .text('Daily Targets:');
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
        .text(`Calories: ${np.daily_calories || '—'} kcal  |  Protein: ${np.protein_g || '—'}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fat: ${np.fat_g || '—'}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold')
            .text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
                .text(`  • ${opt}`);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.3);
        doc.fill('#6B6B6B').fontSize(10).text(`Hydration: ${np.hydration}`);
      }
      if (np.supplements?.length > 0) {
        doc.fill('#6B6B6B').fontSize(10)
          .text(`Supplements: ${np.supplements.join(', ')}`);
      }
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);
    doc.fill('#6B6B6B').fontSize(8).font('Helvetica')
      .text('Generated by Fitness by Maddy Coaching System', { align: 'center' });
    doc.fill('#6B6B6B').fontSize(8)
      .text(`${new Date().toLocaleDateString('en-IN')}`, { align: 'center' });

    doc.end();
  });
}
