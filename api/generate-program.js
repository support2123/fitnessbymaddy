const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase, maskPhone } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const sb = getSupabase();

    const { data: client } = await sb
      .from('clients')
      .select('*, intake:intake_forms(*)' )
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await sb
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const programData = await generateWithClaude(client, recentCheckins || [], lastProgram, week_no);

    if (programData.flagged) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation('program', client.id, client.phone, 'AI safety flag', programData.flagReason);
      return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
    }

    const pdfBuffer = await buildPDF(client, programData, week_no);

    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await sb.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) console.error('Upload error:', uploadErr.message);

    const { data: urlData } = sb.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || '';

    const { error: insertErr } = await sb.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.coachNote,
    });

    if (insertErr) throw insertErr;

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      programData.coachNote || 'New week, new gains! 💪',
    ], pdfUrl);

    await sb.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generateWithClaude(client, checkins, lastProgram, weekNo) {
  const anthropic = new Anthropic();

  const intake = Array.isArray(client.intake) ? client.intake[0] : client.intake;
  const clientProfile = {
    name: client.name,
    program: client.program,
    goal: intake?.goal || 'general fitness',
    age: intake?.age,
    weight: intake?.weight_kg,
    height: intake?.height_cm,
    injuries: intake?.injuries || 'None reported',
    dietPref: intake?.diet_preference || 'No preference',
    experience: intake?.training_experience || 'Intermediate',
    equipment: intake?.equipment_access || 'Full gym',
    availableDays: intake?.available_days || 5,
  };

  const checkinSummary = checkins.map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues,
  }));

  const prompt = `You are a NASM-certified fitness coach creating Week ${weekNo} of a 12-week custom program.

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${JSON.stringify(checkinSummary, null, 2)}

LAST WEEK'S PROGRAM:
${lastProgram ? JSON.stringify({ workout: lastProgram.workout_plan, nutrition: lastProgram.nutrition_plan }, null, 2) : 'First week — no prior program.'}

RULES:
- Never prescribe below 1200 kcal/day for women or 1500 kcal/day for men
- Never recommend banned substances, steroids, or extreme protocols
- Account for reported injuries and medical conditions
- Progressive overload: adjust volume/intensity based on compliance and energy
- Keep it practical for the client's available days and equipment

Return ONLY valid JSON with this exact structure:
{
  "workout": {
    "days": [
      { "day": "Day 1 — Upper Push", "exercises": [{ "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }] }
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 73,
    "meal_timing": "...",
    "notes": "..."
  },
  "coachNote": "One sentence WhatsApp-friendly note for the client about this week's focus",
  "flagged": false,
  "flagReason": ""
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  const parsed = JSON.parse(jsonMatch[0]);

  const cals = parsed.nutrition?.calories || 0;
  if (cals > 0 && cals < 1200) {
    parsed.flagged = true;
    parsed.flagReason = `Dangerously low calories: ${cals} kcal`;
  }

  return parsed;
}

function buildPDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill(BRAND.black);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill(BRAND.gold)
      .text(`WEEK ${weekNo} — CUSTOM PROGRAM`, 50, 75);
    doc.fontSize(10).fill('#CCCCCC')
      .text(`Prepared for ${client.name || 'Client'} | ${client.program}`, 50, 98);

    doc.moveDown(3);

    doc.fontSize(18).fill(BRAND.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).strokeColor(BRAND.gold).lineWidth(2).stroke();
    doc.moveDown(0.5);

    const workout = programData.workout || {};
    const days = workout.days || [];
    for (const day of days) {
      doc.fontSize(13).fill(BRAND.gold).font('Helvetica-Bold')
        .text(day.day || 'Training Day', 50);
      doc.moveDown(0.3);

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        doc.fontSize(10).fill(BRAND.black).font('Helvetica')
          .text(`• ${ex.name}  —  ${ex.sets}×${ex.reps}  |  Rest: ${ex.rest}`, 65);
        if (ex.notes) {
          doc.fontSize(9).fill(BRAND.grey)
            .text(`  ${ex.notes}`, 75);
        }
      }
      doc.moveDown(0.5);
    }

    if (workout.cardio) {
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(`Cardio: ${workout.cardio}`, 50);
    }
    if (workout.rest_days) {
      doc.fontSize(10).fill(BRAND.grey)
        .text(`Rest Days: ${workout.rest_days}`, 50);
    }

    doc.moveDown(1.5);

    doc.fontSize(18).fill(BRAND.black).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).strokeColor(BRAND.gold).lineWidth(2).stroke();
    doc.moveDown(0.5);

    const nutrition = programData.nutrition || {};
    const macroLine = `${nutrition.calories || '—'} kcal  |  P: ${nutrition.protein_g || '—'}g  |  C: ${nutrition.carbs_g || '—'}g  |  F: ${nutrition.fat_g || '—'}g`;
    doc.fontSize(12).fill(BRAND.black).font('Helvetica-Bold')
      .text(macroLine, 50);
    doc.moveDown(0.3);

    if (nutrition.meal_timing) {
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(`Meal Timing: ${nutrition.meal_timing}`, 50);
    }
    if (nutrition.notes) {
      doc.moveDown(0.3);
      doc.fontSize(10).fill(BRAND.grey)
        .text(nutrition.notes, 50, undefined, { width: 495 });
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(BRAND.gold).lineWidth(1).stroke();
    doc.moveDown(0.5);
    doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
      .text('This program is personalised for you by Fitness by Maddy. Do not share or redistribute.', 50, undefined, { align: 'center' });
    doc.fontSize(9).fill(BRAND.gold)
      .text('www.fitnessbymaddy.com', 50, undefined, { align: 'center' });

    doc.end();
  });
}
