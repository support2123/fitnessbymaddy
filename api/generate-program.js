const { getSupabase } = require('./_lib/supabase');
const { sendText } = require('./_lib/whatsapp');
const { detectMarket, maskPhone } = require('./_lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in',
  'starvation', 'very low calorie'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Fetch client data
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Fetch last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Fetch intake data from storage
    let intakeData = null;
    try {
      const { data: intakeFile } = await db.storage
        .from('client-files')
        .download(`clients/${client_id}/intake.json`);
      if (intakeFile) {
        intakeData = JSON.parse(await intakeFile.text());
      }
    } catch (e) {
      // No intake file yet
    }

    // Build prompt for Claude
    const prompt = buildPrompt(client, checkins, intakeData, week_no);

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: `You are a certified personal trainer and nutrition coach creating a weekly program for a real client. Output valid JSON only with keys: workout_plan (object with days), nutrition_plan (object with meals, macros, calories), notes (string with key focus points for the week). Be specific with exercises, sets, reps, rest times. Be safe and evidence-based. Never recommend banned substances, extreme calorie restriction (<1200 for women, <1500 for men), or unrealistic timelines.`,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawText = response.content[0].text;

    // Safety check
    const lower = rawText.toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (lower.includes(flag)) {
        console.error(`Safety flag triggered: "${flag}" for client ${maskPhone(client.phone)}`);
        const { sendTemplate } = require('./_lib/whatsapp');
        await sendTemplate('917082478374', 'escalation_alert', {
          name: 'Maddy',
          templateParams: ['SAFETY_FLAG', client.phone.slice(-4), `Program gen flagged: ${flag}`]
        });
        return res.status(200).json({ action: 'flagged_for_review', flag });
      }
    }

    // Parse JSON from response
    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse program JSON:', e.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    // Generate PDF
    const pdfBuffer = await generatePdf(client, week_no, programData);

    // Upload PDF to Supabase storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: pdfUrlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    // Save to programs table
    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrlData.publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    });

    // Send via WhatsApp
    const market = detectMarket(client.phone);
    const isHinglish = market === 'IN';
    const contextNote = programData.notes
      ? programData.notes.split('.')[0]
      : `Week ${week_no} program ready`;

    let msg;
    if (isHinglish) {
      msg = `🔥 *Week ${week_no} Program Ready!*\n\n${contextNote}\n\nPDF yahan se download karo:\n${pdfUrlData.publicUrl}\n\nKoi doubt ho toh message karo! 💪`;
    } else {
      msg = `🔥 *Week ${week_no} Program Ready!*\n\n${contextNote}\n\nDownload your PDF here:\n${pdfUrlData.publicUrl}\n\nQuestions? Just message! 💪`;
    }

    await sendText(client.phone, msg, true);

    // Update whatsapp_sent_at
    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    console.log(`Program generated: client=${maskPhone(client.phone)} week=${week_no}`);
    return res.status(200).json({ action: 'program_generated', pdf_url: pdfUrlData.publicUrl });

  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  let prompt = `Generate Week ${weekNo} training and nutrition program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'unknown'}\n`;
    prompt += `Height: ${intake.height || 'unknown'}\n`;
    prompt += `Goal: ${intake.goal || 'general fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'none reported'}\n`;
    prompt += `Diet preference: ${intake.diet_preference || 'no preference'}\n`;
    prompt += `Training experience: ${intake.training_experience || 'unknown'}\n`;
    prompt += `Equipment: ${intake.equipment_access || 'full gym'}\n`;
    prompt += `Available days: ${intake.schedule_days || '5'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const ci of checkins) {
      prompt += `- Week ${ci.week_no}: weight=${ci.weight}kg, waist=${ci.waist}cm, compliance=${ci.compliance_score}/10, energy=${ci.energy}/10`;
      if (ci.issues) prompt += `, issues: ${ci.issues}`;
      if (ci.next_week_focus) prompt += `, focus: ${ci.next_week_focus}`;
      prompt += `\n`;
    }
  }

  prompt += `\nProvide a complete, specific program for week ${weekNo}. Include exact exercises, sets, reps, rest periods, and a detailed nutrition plan with meal timing and macros. Output as a single JSON object.`;

  return prompt;
}

function generatePdf(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 30, { align: 'center' });
    doc.fontSize(16).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 70, { align: 'center' });
    doc.fontSize(10).fillColor('#999999')
      .text(`Prepared for ${client.name || 'Client'}`, 50, 95, { align: 'center' });

    doc.moveDown(3);

    // Workout Plan
    doc.fontSize(18).fillColor('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
    doc.moveDown(0.5);

    if (programData.workout_plan) {
      const wp = programData.workout_plan;
      for (const [day, exercises] of Object.entries(wp)) {
        doc.fontSize(13).fillColor('#2C2C2C').text(day.toUpperCase(), 50);
        doc.moveDown(0.3);

        if (Array.isArray(exercises)) {
          for (const ex of exercises) {
            const line = typeof ex === 'string' ? ex : `${ex.name || ex.exercise} — ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '(Rest: ' + ex.rest + ')' : ''}`;
            doc.fontSize(10).fillColor('#6B6B6B').text(`  → ${line}`, 60);
          }
        } else if (typeof exercises === 'string') {
          doc.fontSize(10).fillColor('#6B6B6B').text(`  ${exercises}`, 60);
        }
        doc.moveDown(0.5);
      }
    }

    // Nutrition Plan
    if (doc.y > 650) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
    doc.moveDown(0.5);

    if (programData.nutrition_plan) {
      const np = programData.nutrition_plan;

      if (np.calories || np.macros) {
        doc.fontSize(11).fillColor('#2C2C2C')
          .text(`Daily Target: ${np.calories || 'See below'} kcal`, 50);
        if (np.macros) {
          const m = np.macros;
          doc.fontSize(10).fillColor('#6B6B6B')
            .text(`Protein: ${m.protein || '—'}g | Carbs: ${m.carbs || '—'}g | Fats: ${m.fats || m.fat || '—'}g`, 60);
        }
        doc.moveDown(0.5);
      }

      if (np.meals) {
        for (const [mealName, detail] of Object.entries(np.meals)) {
          doc.fontSize(12).fillColor('#2C2C2C').text(mealName.toUpperCase(), 50);
          const mealText = typeof detail === 'string' ? detail : JSON.stringify(detail);
          doc.fontSize(10).fillColor('#6B6B6B').text(`  ${mealText}`, 60, undefined, { width: 475 });
          doc.moveDown(0.3);
        }
      }
    }

    // Notes
    if (programData.notes) {
      if (doc.y > 680) doc.addPage();
      doc.moveDown(1);
      doc.fontSize(18).fillColor('#B8965A').text('NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#6B6B6B').text(programData.notes, 50, undefined, { width: 495 });
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#C8B89A')
      .text('Fitness by Maddy | fitnessbymaddy.com | @fitnessbymaddy_', 50, undefined, { align: 'center' });

    doc.end();
  });
}
