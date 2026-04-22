const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendAndLog } = require('./lib/whatsapp');
const { maskPhone, PROGRAM_NAMES } = require('./lib/utils');

const MADDY_PHONE = '917082478374';

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarms|steroids/i,
  /lose\s*(10|15|20)\+?\s*kg.*in.*(1|2)\s*week/i,
];

function flagRiskyContent(text) {
  for (const pattern of RISKY_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = {};
    if (intakeMsg && intakeMsg.body) {
      try { intakeData = JSON.parse(intakeMsg.body); } catch (e) { /* ignore */ }
    }

    const checkinSummary = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
    }));

    const anthropic = new Anthropic();

    const systemPrompt = `You are Maddy's AI program architect for FitnessByMaddy. You create personalised weekly workout and nutrition plans.

Rules:
- Evidence-based, safe programming only
- Never recommend banned substances or extreme calorie deficits (<1200 cal for women, <1500 for men)
- Never promise unrealistic timelines
- Consider injuries and medical conditions carefully
- Progressive overload principle
- Nutrition: balanced macros, flexible dieting approach
- Output valid JSON only`;

    const userPrompt = `Create Week ${week_no} program for this client:

Client: ${client.name || 'Client'}
Program: ${PROGRAM_NAMES[client.program] || client.program}
Intake data: ${JSON.stringify(intakeData)}
Recent check-ins: ${JSON.stringify(checkinSummary)}

Return JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS or HIIT", "duration": "20-30 min" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Option A description", "Option B description"] },
      ...
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "notes": "Focus note for the week"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    if (flagRiskyContent(rawText)) {
      await sendAndLog(
        MADDY_PHONE,
        'escalation_alert',
        [maskPhone(client.phone), `Program W${week_no} flagged for risky content — needs manual review`],
        true
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: null,
        nutrition_plan: null,
        notes: 'FLAGGED: Risky content detected — pending Maddy review',
        generated_at: new Date().toISOString(),
      });

      return res.status(200).json({ action: 'flagged_for_review' });
    }

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (e) {
      console.error('Failed to parse Claude response:', e.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(client, week_no, parsed);

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Save to programs table
    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
      pdf_url: pdfUrl,
      generated_at: new Date().toISOString(),
    }).select().single();

    // Send via WhatsApp
    await sendAndLog(
      client.phone,
      'program_ready',
      [client.name || 'there', `Week ${week_no}`, pdfUrl],
      true
    );

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} Week ${week_no}`);
    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(28).font('Helvetica-Bold')
      .fillColor('#B8965A')
      .text('FITNESS BY MADDY', { align: 'center' });

    doc.moveDown(0.5);
    doc.fontSize(18).fillColor('#2C2C2C')
      .text(`WEEK ${weekNo} PROGRAM`, { align: 'center' });

    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#6B6B6B')
      .text(`${client.name || 'Client'} | ${PROGRAM_NAMES[client.program] || client.program}`, { align: 'center' });

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(1);

    // Workout Plan
    if (plan.workout_plan && plan.workout_plan.days) {
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#2C2C2C')
        .text('WORKOUT PLAN');
      doc.moveDown(0.5);

      for (const day of plan.workout_plan.days) {
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#B8965A')
          .text(`${day.day} — ${day.focus}`);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).font('Helvetica').fillColor('#2C2C2C')
              .text(`  ${ex.name}  |  ${ex.sets} sets x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  |  ' + ex.notes : ''}`);
          }
        }
        doc.moveDown(0.5);
      }

      if (plan.workout_plan.cardio) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#2C2C2C')
          .text(`Cardio: ${plan.workout_plan.cardio.frequency} — ${plan.workout_plan.cardio.type} — ${plan.workout_plan.cardio.duration}`);
      }

      doc.moveDown(1);
    }

    // Nutrition Plan
    if (plan.nutrition_plan) {
      if (doc.y > 650) doc.addPage();

      doc.fontSize(16).font('Helvetica-Bold').fillColor('#2C2C2C')
        .text('NUTRITION PLAN');
      doc.moveDown(0.5);

      const n = plan.nutrition_plan;
      doc.fontSize(11).font('Helvetica').fillColor('#2C2C2C')
        .text(`Calories: ${n.calories} kcal  |  Protein: ${n.protein_g}g  |  Carbs: ${n.carbs_g}g  |  Fat: ${n.fat_g}g`);
      doc.moveDown(0.5);

      if (n.meals) {
        for (const meal of n.meals) {
          doc.fontSize(12).font('Helvetica-Bold').fillColor('#B8965A')
            .text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).font('Helvetica').fillColor('#2C2C2C')
                .text(`  • ${opt}`);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (n.supplements && n.supplements.length > 0) {
        doc.moveDown(0.3);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#2C2C2C')
          .text(`Supplements: ${n.supplements.join(', ')}`);
      }

      if (n.hydration) {
        doc.fontSize(11).font('Helvetica').fillColor('#6B6B6B')
          .text(`Hydration: ${n.hydration}`);
      }
    }

    // Notes
    if (plan.notes) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica-BoldOblique').fillColor('#B8965A')
        .text(`Coach's Note: ${plan.notes}`);
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica').fillColor('#C8B89A')
      .text('www.fitnessbymaddy.com | @fitnessbymaddy_', { align: 'center' });

    doc.end();
  });
}
