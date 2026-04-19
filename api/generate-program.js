const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { maskPhone, jsonResponse, handleCors, PROGRAM_NAMES } = require('../lib/utils');

const SAFETY_FLAGS = [
  'below 1200 calories', 'under 1000 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10 kg in 1 week', 'lose 20 pounds in'
];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return jsonResponse(res, { error: 'client_id and week_no required' }, 400);
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return jsonResponse(res, { error: 'Client not found' }, 404);

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .limit(1)
      .single();

    if (existingProgram) {
      return jsonResponse(res, { error: 'Program already generated for this week' }, 409);
    }

    const anthropic = new Anthropic();
    const prompt = buildPrompt(client, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    const flagged = SAFETY_FLAGS.some(f => content.toLowerCase().includes(f));
    if (flagged) {
      await escalateToMaddy('Generated program flagged for safety review', {
        clientPhone: client.phone,
        name: client.name,
        details: `Week ${week_no} — auto-generation halted due to safety flag`
      });
      return jsonResponse(res, { error: 'Flagged for manual review', flagged: true }, 422);
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || parsed.workouts || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || null,
    }).select().single();

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.notes || `Your Week ${week_no} program is ready!`
    ], pdfUrl);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week=${week_no}`);
    return jsonResponse(res, { success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return jsonResponse(res, { error: 'Internal error' }, 500);
  }
};

function buildPrompt(client, checkins, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Not specified'}
- Goal: ${client.goal || 'General fitness'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

Generate Week ${weekNo} program as JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 65,
    "meal_timing": "...",
    "sample_meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-liner weekly focus or motivation"
}

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- Adjust based on check-in data (progressive overload if compliance is high, deload if energy is low)
- Be specific with exercise names, sets, reps
- Keep notes concise and motivating`;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fillColor('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 70, { align: 'center' });
    doc.fillColor('#C8B89A').fontSize(10)
      .text(`${client.name || 'Client'} | ${PROGRAM_NAMES[client.program] || client.program}`, 50, 92, { align: 'center' });

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    const workout = programData.workout_plan || programData.workouts || {};
    if (workout.days) {
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#B8965A')
        .text('WORKOUT PLAN', { underline: true });
      doc.moveDown(0.5);

      for (const day of workout.days) {
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#2C2C2C')
          .text(`${day.day} — ${day.focus || ''}`);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).font('Helvetica').fillColor('#6B6B6B')
              .text(`  ${ex.name}: ${ex.sets} sets x ${ex.reps} | Rest: ${ex.rest || '60s'}${ex.notes ? ' | ' + ex.notes : ''}`, {
                indent: 15
              });
          }
        }
        doc.moveDown(0.5);

        if (doc.y > doc.page.height - 100) doc.addPage();
      }
    }

    const nutrition = programData.nutrition_plan || programData.nutrition || {};
    if (nutrition.calories) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc.moveDown(1);
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#B8965A')
        .text('NUTRITION PLAN', { underline: true });
      doc.moveDown(0.5);

      doc.fontSize(11).font('Helvetica').fillColor('#2C2C2C')
        .text(`Daily Targets: ${nutrition.calories} kcal | Protein: ${nutrition.protein_g}g | Carbs: ${nutrition.carbs_g}g | Fats: ${nutrition.fats_g}g`);
      doc.moveDown(0.3);

      if (nutrition.meal_timing) {
        doc.text(`Meal Timing: ${nutrition.meal_timing}`);
      }

      if (nutrition.sample_meals) {
        doc.moveDown(0.5);
        for (const meal of nutrition.sample_meals) {
          doc.font('Helvetica-Bold').text(`${meal.meal}:`);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.font('Helvetica').fillColor('#6B6B6B').text(`  - ${opt}`, { indent: 15 });
            }
          }
          doc.fillColor('#2C2C2C');
        }
      }

      if (nutrition.supplements) {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').text('Supplements:');
        doc.font('Helvetica').text(`  ${nutrition.supplements.join(', ')}`);
      }
    }

    if (programData.notes) {
      doc.moveDown(1.5);
      doc.rect(50, doc.y, doc.page.width - 100, 40).fill('#F0EAE0');
      doc.fillColor('#2C2C2C').fontSize(11).font('Helvetica-Bold')
        .text(programData.notes, 60, doc.y - 30, {
          width: doc.page.width - 120, align: 'center'
        });
    }

    const bottomY = doc.page.height - 30;
    doc.fillColor('#C8B89A').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | This program is personalized — do not share.', 50, bottomY, { align: 'center' });

    doc.end();
  });
}
