const { getClient } = require('./lib/supabase');
const { sendText, notifyMaddy } = require('./lib/whatsapp');
const { cors, parseBody, maskPhone, isHinglish, detectMarket } = require('./lib/helpers');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .limit(1);

    if (existingProgram && existingProgram.length > 0) {
      return res.status(200).json({ ok: true, message: 'Program already exists', existing: true });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create weekly workout and nutrition plans that are:
- Science-backed and safe
- Progressive (building on previous weeks)
- Adapted to client feedback and check-in data
- Realistic and sustainable

SAFETY RULES (never violate):
- Never recommend calorie intake below 1200 for women or 1500 for men
- Never recommend banned or unregulated supplements
- Never promise specific weight loss timelines
- If the client reports pain, injury, or medical issues, flag for human review
- Always include rest days and deload guidance

Output format: JSON with two top-level keys:
1. "workout_plan": object with days (day_1 through day_7), each containing:
   - "focus": muscle group or activity type
   - "exercises": array of { "name", "sets", "reps", "rest_seconds", "notes" }
   - "duration_minutes": estimated workout time
2. "nutrition_plan": object with:
   - "daily_calories": number
   - "protein_g": number
   - "carbs_g": number
   - "fat_g": number
   - "meals": array of { "meal_name", "options": string[] }
   - "hydration_liters": number
   - "supplements": string[] (only evidence-based)
3. "coach_notes": brief 2-3 sentence note to the client about this week's focus`;

    const clientContext = buildClientContext(client, recentCheckins);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n\n${clientContext}\n\nReturn ONLY valid JSON, no markdown fences.`
      }]
    });

    const programText = response.content[0].text.trim();
    let programData;
    try {
      const jsonStr = programText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
      programData = JSON.parse(jsonStr);
    } catch {
      console.error('[Program] Failed to parse Claude response as JSON');
      await notifyMaddy(
        'Program Generation Failed',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReason: Invalid JSON from Claude API`
      );
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    if (hasSafetyIssues(programData)) {
      await notifyMaddy(
        'Program Flagged for Review',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReason: Safety check failed — possible extreme calorie cut or risky recommendation. Manual review needed.`
      );
      return res.status(200).json({ ok: true, flagged: true, message: 'Flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const pdfPath = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('[Program] PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = await db.storage
      .from('clients')
      .createSignedUrl(pdfPath, 60 * 60 * 24 * 7);
    const pdfUrl = urlData ? urlData.signedUrl : null;

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || null
    });

    if (insertErr) {
      console.error('[Program] DB insert error:', insertErr.message);
    }

    if (pdfUrl) {
      const market = detectMarket(client.phone);
      const coachNote = programData.coach_notes || '';
      let msg;
      if (isHinglish(market)) {
        msg = `🔥 Week ${week_no} ka program ready hai!\n\n${coachNote}\n\nPDF download karo: ${pdfUrl}`;
      } else {
        msg = `🔥 Your Week ${week_no} program is ready!\n\n${coachNote}\n\nDownload your PDF: ${pdfUrl}`;
      }
      const sendResult = await sendText(client.phone, msg);

      if (sendResult.ok) {
        await db.from('programs')
          .update({ whatsapp_sent_at: new Date().toISOString() })
          .eq('client_id', client_id)
          .eq('week_no', week_no);
      }
    }

    console.log(`[Program] Generated week ${week_no} for ${maskPhone(client.phone)}`);
    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('[Program] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildClientContext(client, checkins) {
  let ctx = `Name: ${client.name || 'Unknown'}
Program: ${client.program}
Started: ${client.program_started_at}
`;

  if (checkins && checkins.length > 0) {
    ctx += '\nRecent Check-Ins:\n';
    for (const ci of checkins) {
      ctx += `- Week ${ci.week_no}: Weight=${ci.weight || 'N/A'}kg, Waist=${ci.waist || 'N/A'}cm, Compliance=${ci.compliance_score || 'N/A'}/10, Energy=${ci.energy || 'N/A'}/10`;
      if (ci.issues) ctx += `, Issues: ${ci.issues}`;
      if (ci.next_week_focus) ctx += `, Focus: ${ci.next_week_focus}`;
      ctx += '\n';
    }
  } else {
    ctx += '\nNo previous check-ins available (first week).\n';
  }

  return ctx;
}

function hasSafetyIssues(programData) {
  const np = programData.nutrition_plan;
  if (!np) return false;
  if (np.daily_calories && np.daily_calories < 1200) return true;
  if (np.supplements) {
    const banned = ['steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra', 'hgh'];
    for (const supp of np.supplements) {
      if (banned.some(b => supp.toLowerCase().includes(b))) return true;
    }
  }
  return false;
}

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595.28, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF').text(`Week ${weekNo} Program`, 50, 72, { align: 'center' });
    doc.fontSize(10).fillColor('#D4AF7A').text(
      `${client.name || 'Client'} | ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      50, 94, { align: 'center' }
    );

    doc.moveDown(3);

    // Workout Plan
    const wp = programData.workout_plan;
    if (wp) {
      doc.fontSize(18).fillColor('#2C2C2C').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(1).stroke();
      doc.moveDown(0.5);

      for (const [day, plan] of Object.entries(wp)) {
        if (doc.y > 700) { doc.addPage(); doc.moveDown(); }
        const dayLabel = day.replace('_', ' ').toUpperCase();
        doc.fontSize(13).fillColor('#B8965A').text(dayLabel + (plan.focus ? ` — ${plan.focus}` : ''));
        if (plan.duration_minutes) {
          doc.fontSize(9).fillColor('#6B6B6B').text(`Duration: ~${plan.duration_minutes} min`);
        }
        doc.moveDown(0.3);

        if (plan.exercises && Array.isArray(plan.exercises)) {
          for (const ex of plan.exercises) {
            if (doc.y > 730) { doc.addPage(); doc.moveDown(); }
            doc.fontSize(10).fillColor('#2C2C2C')
              .text(`  → ${ex.name}  |  ${ex.sets || '-'} x ${ex.reps || '-'}  |  Rest: ${ex.rest_seconds || '-'}s`, {
                indent: 10
              });
            if (ex.notes) {
              doc.fontSize(8).fillColor('#6B6B6B').text(`      ${ex.notes}`, { indent: 20 });
            }
          }
        }
        doc.moveDown(0.8);
      }
    }

    // Nutrition Plan
    const np = programData.nutrition_plan;
    if (np) {
      if (doc.y > 550) doc.addPage();
      doc.moveDown();
      doc.fontSize(18).fillColor('#2C2C2C').text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(1).stroke();
      doc.moveDown(0.5);

      doc.fontSize(11).fillColor('#2C2C2C');
      if (np.daily_calories) doc.text(`Daily Calories: ${np.daily_calories} kcal`);
      if (np.protein_g) doc.text(`Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g || '-'}g  |  Fat: ${np.fat_g || '-'}g`);
      if (np.hydration_liters) doc.text(`Hydration: ${np.hydration_liters}L per day`);
      doc.moveDown(0.5);

      if (np.meals && Array.isArray(np.meals)) {
        for (const meal of np.meals) {
          if (doc.y > 730) { doc.addPage(); doc.moveDown(); }
          doc.fontSize(11).fillColor('#B8965A').text(meal.meal_name || 'Meal');
          if (meal.options && Array.isArray(meal.options)) {
            for (const opt of meal.options) {
              doc.fontSize(9).fillColor('#2C2C2C').text(`  • ${opt}`, { indent: 10 });
            }
          }
          doc.moveDown(0.4);
        }
      }

      if (np.supplements && np.supplements.length > 0) {
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor('#B8965A').text('Supplements');
        for (const supp of np.supplements) {
          doc.fontSize(9).fillColor('#2C2C2C').text(`  • ${supp}`, { indent: 10 });
        }
      }
    }

    // Coach Notes
    if (programData.coach_notes) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(1.5);
      doc.fontSize(18).fillColor('#2C2C2C').text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#6B6B6B').text(programData.coach_notes, { width: 495 });
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#C8B89A').text(
      'This program is for informational purposes and should be performed under proper guidance. Consult your physician before starting any exercise program.',
      50, doc.y, { width: 495, align: 'center' }
    );

    doc.end();
  });
}
