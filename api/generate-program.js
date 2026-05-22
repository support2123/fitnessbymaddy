const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme calorie',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for weight loss',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

async function generateWithClaude(clientData, checkins, weekNo) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are Maddy's program architect — an expert NASM-certified personal trainer and nutrition coach. Generate a weekly training + nutrition plan for this client.

RULES:
- Base everything on the client's profile, goals, and recent check-in data
- Progressive overload: each week should build on the last
- Never prescribe below 1200 kcal for women or 1500 kcal for men
- Never recommend banned substances, extreme protocols, or anything medically unsafe
- Include warm-up and cool-down in every session
- Adjust based on compliance and energy scores from check-ins
- Output valid JSON with "workout_plan" and "nutrition_plan" keys
- workout_plan: array of 5-6 day objects with exercises, sets, reps, rest
- nutrition_plan: daily calories, macros, 3 meals + 2 snacks with examples
- Include a "coach_note" field with a 2-line motivational + tactical note`;

  const userPrompt = `CLIENT PROFILE:
${JSON.stringify(clientData, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(checkins, null, 2)}

Generate WEEK ${weekNo} program. Return ONLY valid JSON.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(programData, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fillColor('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fillColor('#FFFFFF').fontSize(14).text(`Week ${weekNo} Program — ${clientName || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(4);
    doc.fillColor('#2C2C2C');

    const workout = programData.workout_plan;
    if (Array.isArray(workout)) {
      doc.fontSize(20).fillColor('#B8965A').text('WORKOUT PLAN', { underline: true });
      doc.moveDown(0.5);

      for (const day of workout) {
        doc.fontSize(14).fillColor('#2C2C2C').text(day.day || day.name || 'Training Day', { continued: false });
        doc.moveDown(0.3);

        const exercises = day.exercises || [];
        for (const ex of exercises) {
          const line = `  ${ex.name || ex.exercise}: ${ex.sets || 3}x${ex.reps || '10'} — Rest ${ex.rest || '60s'}`;
          doc.fontSize(10).fillColor('#6B6B6B').text(line);
        }
        doc.moveDown(0.5);

        if (doc.y > 700) doc.addPage();
      }
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fillColor('#B8965A').fontSize(16).text('NUTRITION PLAN', 50, 20, { align: 'center' });
    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      if (nutrition.daily_calories) {
        doc.fontSize(14).text(`Daily Target: ${nutrition.daily_calories} kcal`);
      }
      if (nutrition.macros) {
        doc.fontSize(10).fillColor('#6B6B6B')
          .text(`Protein: ${nutrition.macros.protein || '—'}g | Carbs: ${nutrition.macros.carbs || '—'}g | Fat: ${nutrition.macros.fat || '—'}g`);
      }
      doc.moveDown();

      const meals = nutrition.meals || [];
      for (const meal of meals) {
        doc.fontSize(12).fillColor('#2C2C2C').text(meal.name || meal.time || 'Meal');
        doc.fontSize(10).fillColor('#6B6B6B').text(meal.description || meal.example || '');
        doc.moveDown(0.3);
      }
    }

    if (programData.coach_note) {
      doc.moveDown();
      doc.rect(50, doc.y, doc.page.width - 100, 60).fill('#FAF8F4');
      doc.fillColor('#B8965A').fontSize(10).text(`Coach's Note: ${programData.coach_note}`, 60, doc.y - 50, {
        width: doc.page.width - 120,
      });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    if (client.lead_id) {
      const { data: intakeFile } = await supabase.storage
        .from('client-data')
        .download(`intake/${client.lead_id}.json`);
      if (intakeFile) {
        try {
          intakeData = JSON.parse(await intakeFile.text());
        } catch (_) {}
      }
    }

    const clientProfile = {
      name: client.name,
      program: client.program,
      started: client.program_started_at,
      intake: intakeData,
    };

    const programData = await generateWithClaude(clientProfile, checkins || [], week_no);

    const safetyIssue = hasSafetyIssue(JSON.stringify(programData));
    if (safetyIssue) {
      const { escalate } = require('./_lib/escalation');
      await escalate(client.phone, `Unsafe program content: ${safetyIssue}`, `Week ${week_no} generation flagged`);
      return res.status(200).json({ action: 'flagged', reason: safetyIssue });
    }

    const pdfBuffer = await generatePDF(programData, client.name, week_no);
    const pdfPath = `clients/${client.phone}/week_${week_no}.pdf`;

    await supabase.storage.from('client-data').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = supabase.storage.from('client-data').getPublicUrl(pdfPath);
    const pdfUrl = urlData ? urlData.publicUrl : '';

    await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || null,
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      week_no.toString(),
      programData.coach_note || 'New week, new gains!',
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({
      success: true,
      program_id: client_id,
      week_no,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'program generation failed' });
  }
};
