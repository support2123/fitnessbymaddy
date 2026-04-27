const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getClient } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i,
  /under\s*1000\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /anabolic\s*steroid/i,
  /crash\s*diet/i,
  /lose\s*\d{2,}\s*(lbs?|kg)\s*(in|per)\s*(a\s*)?week/i,
];

function checkSafety(text) {
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) return pattern.source;
  }
  return null;
}

async function generateWithClaude(client, checkins) {
  const anthropic = new Anthropic();

  const lastCheckins = checkins.slice(-2).map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues,
  }));

  const prompt = `You are a certified fitness coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Not specified'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

RECENT CHECK-INS:
${JSON.stringify(lastCheckins, null, 2)}

Generate a complete weekly program with:
1. A 6-day workout plan (1 rest day) with exercises, sets, reps, and rest periods
2. A nutrition plan with daily calories, macros, and 4 meal suggestions

Respond ONLY with valid JSON in this exact format:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Exercise", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meals": [
      { "time": "8:00 AM", "name": "Breakfast", "items": ["item1", "item2"], "calories": 500 }
    ]
  },
  "coach_note": "Brief motivational note for the client"
}

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or supplements beyond basic protein/creatine
- Respect all injuries and limitations
- Be progressive: if compliance and energy are high, increase intensity slightly
- If issues were reported, adjust accordingly`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');

  return JSON.parse(jsonMatch[0]);
}

function buildPdf(programData, client, weekNo) {
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
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(3);

    const wp = programData.workout_plan;
    if (wp?.days) {
      doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);

      for (const day of wp.days) {
        doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60);
            if (ex.notes) {
              doc.fill('#6B6B6B').fontSize(9).text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);
      }
    }

    const np = programData.nutrition_plan;
    if (np) {
      if (doc.y > 600) doc.addPage();
      doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold').text('NUTRITION PLAN', 50);
      doc.moveDown(0.3);
      doc.fill('#6B6B6B').fontSize(11).font('Helvetica')
        .text(`Daily Target: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold')
            .text(`${meal.time} — ${meal.name} (${meal.calories} kcal)`, 50);
          if (meal.items) {
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
              .text(`  ${meal.items.join(', ')}`, 60);
          }
          doc.moveDown(0.3);
        }
      }
    }

    if (programData.coach_note) {
      doc.moveDown(1);
      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('Coach\'s Note:', 50);
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica').text(programData.coach_note, 50);
    }

    doc.moveDown(2);
    doc.fill('#C8B89A').fontSize(8).font('Helvetica')
      .text('This program is personalized for you. Do not share. © FitnessByMaddy', 50, doc.page.height - 50, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: true });

    console.log(`Generating week ${week_no} for ${maskPhone(client.phone)}`);

    const programData = await generateWithClaude(client, checkins || []);
    const fullText = JSON.stringify(programData);

    const safetyIssue = checkSafety(fullText);
    if (safetyIssue) {
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note,
        flagged: true,
        flag_reason: `Safety flag: ${safetyIssue}`,
      });

      await db.from('escalations').insert({
        phone: client.phone,
        client_id,
        reason: `Program flagged: ${safetyIssue}`,
        trigger_message: `Auto-generated program for week ${week_no} triggered safety check`,
      });

      return res.status(200).json({
        ok: true,
        flagged: true,
        reason: safetyIssue,
        message: 'Program flagged for Maddy review',
      });
    }

    const pdfBuffer = await buildPdf(programData, client, week_no);
    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client_id}/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage
      .from('programs')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData?.publicUrl || null;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note,
    }).select().single();

    const note = programData.coach_note || `Your Week ${week_no} program is ready!`;
    const message = `Here's your Week ${week_no} program! ${note}\n\n${pdfUrl || 'PDF will be shared shortly.'}`;
    const sendResult = await sendText(client.phone, message, true);

    if (sendResult.sent) {
      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('id', program.id);
    }

    return res.status(200).json({
      ok: true,
      program_id: program.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
