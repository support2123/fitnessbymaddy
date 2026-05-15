const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .like('body', '%[INTAKE FORM]%')
      .order('sent_at', { ascending: false })
      .limit(1);

    let intakeData = null;
    if (intakeMsg && intakeMsg.length > 0) {
      try {
        const jsonStr = intakeMsg[0].body.replace('[INTAKE FORM] ', '');
        intakeData = JSON.parse(jsonStr);
      } catch (e) {}
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a fitness client. You work for FitnessByMaddy, a premium online coaching brand.

RULES:
- Create science-based, safe programs only
- Never suggest extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never suggest banned or dangerous substances
- Never promise unrealistic timelines
- Tailor to the client's injuries, conditions, and preferences
- Include warm-up and cool-down in every workout
- Provide 5-6 training days with 1-2 rest days

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name":"...","sets":3,"reps":"8-12","rest":"60s","notes":"..."}] }
    ],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["...","..."] }
    ],
    "supplements": ["..."],
    "notes": "..."
  },
  "weekly_focus": "...",
  "safety_flag": false
}

Set safety_flag to true if anything about this client's data suggests they need medical clearance first.`;

    const clientContext = `
CLIENT PROFILE:
- Name: ${client.name || 'Unknown'}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
${intakeData ? `- Age: ${intakeData.age || 'N/A'}
- Gender: ${intakeData.gender || 'N/A'}
- Height: ${intakeData.height || 'N/A'}
- Goal: ${intakeData.goal || 'N/A'}
- Injuries: ${intakeData.injuries || 'None reported'}
- Diet preference: ${intakeData.diet_pref || 'No preference'}
- Schedule: ${intakeData.schedule || 'Flexible'}
- Medical conditions: ${intakeData.medical_conditions || 'None'}
- Experience: ${intakeData.experience_level || 'Intermediate'}` : '- No intake form data available'}

RECENT CHECK-INS:
${checkins && checkins.length > 0
  ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : 'No previous check-ins'}

Generate the Week ${week_no} program.`;

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: clientContext }]
    });

    const responseText = response.content[0].text;
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    if (programData.safety_flag) {
      await notifyMaddy(
        'Safety flag on generated program',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReview before sending.`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'SAFETY FLAGGED - awaiting Maddy review'
      });
      return res.status(200).json({ ok: true, action: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `${client_id}/${fileName}`;

    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload failed:', uploadErr.message);
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData?.publicUrl || null;

    const { data: programRecord } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_focus
    }).select().single();

    if (pdfUrl) {
      await sendWhatsApp(client.phone, 'weekly_program', [
        client.name || 'there',
        `${week_no}`,
        programData.weekly_focus || 'Stay consistent this week!'
      ], pdfUrl);

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', programRecord.id);
    }

    return res.status(200).json({
      ok: true,
      program_id: programRecord?.id,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generatePDF(programData, client, weekNo) {
  const PDFDocument = require('pdfkit');

  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF')
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill(gold)
      .text(`Week ${weekNo} Program`, 50, 72);
    doc.fontSize(10).fill('#AAAAAA')
      .text(`Client: ${client.name || 'Client'} | ${new Date().toLocaleDateString('en-GB')}`, 50, 95);

    doc.moveDown(3);
    doc.y = 150;

    if (programData.weekly_focus) {
      doc.fontSize(11).fill(gold).font('Helvetica-Bold')
        .text('WEEKLY FOCUS', 50);
      doc.fontSize(10).fill(charcoal).font('Helvetica')
        .text(programData.weekly_focus, 50, undefined, { width: 495 });
      doc.moveDown(1.5);
    }

    doc.fontSize(16).fill(charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
    doc.moveDown(0.5);

    const wp = programData.workout_plan;
    if (wp && wp.days) {
      for (const day of wp.days) {
        if (doc.y > 680) { doc.addPage(); doc.y = 50; }

        doc.fontSize(12).fill(gold).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (doc.y > 710) { doc.addPage(); doc.y = 50; }
            doc.fontSize(9).fill(charcoal).font('Helvetica-Bold')
              .text(`  ${ex.name}`, 60, undefined, { continued: true });
            doc.font('Helvetica')
              .text(`  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  |  ' + ex.notes : ''}`, { width: 470 });
          }
        }
        doc.moveDown(0.8);
      }
    }

    if (doc.y > 500) { doc.addPage(); doc.y = 50; }

    doc.moveDown(1);
    doc.fontSize(16).fill(charcoal).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
    doc.moveDown(0.5);

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(10).fill(charcoal).font('Helvetica-Bold')
        .text(`Daily Targets: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 50);
      doc.moveDown(0.8);

      if (np.meals) {
        for (const meal of np.meals) {
          if (doc.y > 710) { doc.addPage(); doc.y = 50; }
          doc.fontSize(10).fill(gold).font('Helvetica-Bold')
            .text(meal.meal, 60);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill(charcoal).font('Helvetica')
                .text(`  • ${opt}`, 70, undefined, { width: 460 });
            }
          }
          doc.moveDown(0.5);
        }
      }

      if (np.supplements && np.supplements.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill(gold).font('Helvetica-Bold')
          .text('Supplements:', 60);
        for (const s of np.supplements) {
          doc.fontSize(9).fill(charcoal).font('Helvetica')
            .text(`  • ${s}`, 70);
        }
      }

      if (np.notes) {
        doc.moveDown(0.5);
        doc.fontSize(9).fill(charcoal).font('Helvetica')
          .text(np.notes, 60, undefined, { width: 470 });
      }
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#999999')
        .text(
          'fitnessbymaddy.com | This program is personalised — do not share.',
          50, doc.page.height - 40,
          { width: 495, align: 'center' }
        );
    }

    doc.end();
  });
}
