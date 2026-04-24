const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /extreme\s*(cut|deficit|fast)/i,
  /banned\s*substance/i,
  /steroid/i,
  /dnp|clenbuterol|ephedra/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic();

    const systemPrompt = `You are Maddy's program architect for FitnessByMaddy. Generate a weekly training and nutrition plan.

Rules:
- Science-backed, progressive overload principles
- Never recommend banned substances, extreme caloric deficits (<1200 cal for women, <1500 for men), or unrealistic timelines
- Warm, expert tone — not bro-science
- Output valid JSON only with keys: workout_plan, nutrition_plan, weekly_note
- workout_plan: array of 5-6 day objects with exercises, sets, reps, rest
- nutrition_plan: object with calories, protein_g, carbs_g, fat_g, meal_framework (array of meals)
- weekly_note: 2-3 sentence motivational + tactical note for the client`;

    const userPrompt = `Client: ${client.name || 'Client'}
Program: ${client.program}
Week: ${week_no}

${recentCheckins?.length ? `Recent check-ins:
${recentCheckins.map(c => `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')}` : 'No check-in data yet (Week 1).'}

${prevPrograms?.length ? `Previous week plan summary available for progression reference.` : 'First program — build foundation week.'}

Generate the Week ${week_no} program as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData);
    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(fullText)) {
        await db.from('escalations').insert({
          phone: client.phone,
          reason: `Risky content in generated program: ${pattern.source}`,
          message_body: `Week ${week_no} program flagged for review`,
        });
        return res.status(200).json({
          message: 'Program flagged for Maddy review',
          flagged: true,
        });
      }
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `${client.folder_url || `clients/${client.id}`}/${fileName}`;

    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    let pdfUrl = null;
    if (!uploadErr) {
      const { data: urlData } = db.storage
        .from('programs')
        .getPublicUrl(storagePath);
      pdfUrl = urlData?.publicUrl;
    }

    const { data: program } = await db
      .from('programs')
      .upsert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.weekly_note,
        pdf_url: pdfUrl,
        generated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    if (pdfUrl) {
      const weekNote = programData.weekly_note || `Your Week ${week_no} program is ready!`;
      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_program',
        bodyValues: [client.name || 'there', String(week_no), weekNote],
        mediaUrl: pdfUrl,
      });

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({
      message: 'Program generated',
      program_id: program.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, 595, 842).fill('#1a1a1a');

    doc.fontSize(10).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 40, { characterSpacing: 4 });

    doc.moveTo(50, 60).lineTo(545, 60).strokeColor('#B8965A').lineWidth(0.5).stroke();

    doc.fontSize(32).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo}`, 50, 80);
    doc.fontSize(14).fillColor('#B8965A')
      .text(`${client.name || 'Client'} | ${(client.program || '').replace(/_/g, ' ').toUpperCase()}`, 50, 120);

    let y = 160;

    if (programData.weekly_note) {
      doc.fontSize(11).fillColor('#D4AF7A')
        .text(programData.weekly_note, 50, y, { width: 495 });
      y += 50;
    }

    if (programData.workout_plan && Array.isArray(programData.workout_plan)) {
      doc.fontSize(16).fillColor('#FFFFFF').text('TRAINING PLAN', 50, y);
      y += 30;

      for (const day of programData.workout_plan) {
        if (y > 750) {
          doc.addPage();
          doc.rect(0, 0, 595, 842).fill('#1a1a1a');
          y = 50;
        }

        doc.fontSize(12).fillColor('#B8965A')
          .text(day.day || day.name || 'Training Day', 50, y);
        y += 18;

        const exercises = day.exercises || [];
        for (const ex of exercises) {
          if (y > 760) {
            doc.addPage();
            doc.rect(0, 0, 595, 842).fill('#1a1a1a');
            y = 50;
          }
          const line = `${ex.name || ex.exercise || 'Exercise'}: ${ex.sets || 3}x${ex.reps || '10'} | Rest: ${ex.rest || '60s'}`;
          doc.fontSize(10).fillColor('#FFFFFF').text(line, 70, y, { width: 475 });
          y += 16;
        }
        y += 10;
      }
    }

    if (programData.nutrition_plan) {
      if (y > 650) {
        doc.addPage();
        doc.rect(0, 0, 595, 842).fill('#1a1a1a');
        y = 50;
      }

      doc.fontSize(16).fillColor('#FFFFFF').text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = programData.nutrition_plan;
      doc.fontSize(11).fillColor('#B8965A')
        .text(`Calories: ${np.calories || '—'} | Protein: ${np.protein_g || '—'}g | Carbs: ${np.carbs_g || '—'}g | Fat: ${np.fat_g || '—'}g`, 50, y);
      y += 24;

      if (np.meal_framework && Array.isArray(np.meal_framework)) {
        for (const meal of np.meal_framework) {
          if (y > 760) {
            doc.addPage();
            doc.rect(0, 0, 595, 842).fill('#1a1a1a');
            y = 50;
          }
          doc.fontSize(10).fillColor('#FFFFFF')
            .text(`${meal.name || meal.meal || 'Meal'}: ${meal.description || meal.foods || ''}`, 70, y, { width: 475 });
          y += 16;
        }
      }
    }

    doc.fontSize(8).fillColor('#666666')
      .text('fitnessbymaddy.com | This program is personalised — do not share.', 50, 810, { align: 'center', width: 495 });

    doc.end();
  });
}
