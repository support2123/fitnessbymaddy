const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const DANGEROUS_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /banned\s*substance/i,
  /steroid/i,
  /dnp/i,
  /clenbuterol/i,
  /extreme\s*fast/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i
];

function isSafe(plan) {
  const text = JSON.stringify(plan);
  return !DANGEROUS_PATTERNS.some(p => p.test(text));
}

async function generatePDF(workout, nutrition, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`${clientName || 'Client'} — Week ${weekNo} Program`, 50, 75);

    doc.moveDown(3);

    doc.fontSize(20).fill('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(14).fill('#B8965A').text(day.name || day.day, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(11).fill('#2C2C2C')
              .text(`  ${ex.name}  —  ${ex.sets || '3'} x ${ex.reps || '10'}`, 60);
            if (ex.notes) {
              doc.fontSize(9).fill('#6B6B6B').text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(11).fill('#2C2C2C').text(JSON.stringify(workout, null, 2), 50);
    }

    if (doc.y > 650) doc.addPage();
    doc.moveDown(1);

    doc.fontSize(20).fill('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    if (nutrition && nutrition.meals) {
      if (nutrition.calories) {
        doc.fontSize(12).fill('#2C2C2C')
          .text(`Daily Target: ${nutrition.calories} kcal | P: ${nutrition.protein || '-'}g | C: ${nutrition.carbs || '-'}g | F: ${nutrition.fat || '-'}g`, 50);
        doc.moveDown(0.5);
      }

      for (const meal of nutrition.meals) {
        doc.fontSize(13).fill('#B8965A').text(meal.name || meal.meal, 50);
        doc.fontSize(11).fill('#2C2C2C').text(`  ${meal.description || meal.foods || ''}`, 60);
        if (meal.calories) {
          doc.fontSize(9).fill('#6B6B6B').text(`  ~${meal.calories} kcal`, 60);
        }
        doc.moveDown(0.3);
      }
    } else {
      doc.fontSize(11).fill('#2C2C2C').text(JSON.stringify(nutrition, null, 2), 50);
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#6B6B6B')
      .text('This program is designed by Fitness by Maddy. Consult a physician before starting any fitness program.', 50, undefined, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

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

    const systemPrompt = `You are a certified personal trainer and nutrition coach working for Fitness by Maddy, an elite online coaching brand. Generate a weekly training and nutrition program.

RULES:
- Programs must be safe, evidence-based, and appropriate for the client's level
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned substances, steroids, or extreme protocols
- Never promise specific weight loss timelines
- Use progressive overload principles
- Include warm-up and cool-down guidance
- Consider any injuries or medical conditions

OUTPUT FORMAT (JSON only, no markdown):
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "notes": "2 min rest" }
        ]
      }
    ],
    "weekly_notes": "string"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fat": 70,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "...", "calories": 500 }
    ],
    "hydration": "string",
    "supplements": "string"
  },
  "coach_note": "One-liner context for WhatsApp message"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Anonymous'}
Program: ${client.program}
Phone market: ${client.phone?.startsWith('91') ? 'India' : 'International'}

${recentCheckins && recentCheckins.length > 0 ? `Recent check-ins:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No previous check-ins yet (first week).'}

${prevProgram ? `Previous week plan summary:
Workout: ${JSON.stringify(prevProgram.workout_plan).slice(0, 500)}
Nutrition: ${JSON.stringify(prevProgram.nutrition_plan).slice(0, 500)}` : 'No previous program (first week).'}

Return ONLY valid JSON, no markdown fences.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const raw = response.content[0].text;
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse Claude response as JSON');
      }
    }

    const { workout_plan, nutrition_plan, coach_note } = parsed;

    if (!isSafe(workout_plan) || !isSafe(nutrition_plan)) {
      await escalateToMaddy(
        'Unsafe program flagged',
        `Client: ${maskPhone(client.phone)} | Week ${week_no} — auto-generation halted for safety review`
      );
      return res.status(200).json({
        ok: false,
        reason: 'flagged_for_review',
        message: 'Program flagged for Maddy review due to safety concerns'
      });
    }

    const pdfBuffer = await generatePDF(workout_plan, nutrition_plan, client.name, week_no);

    const pdfPath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        pdf_url: publicUrl?.publicUrl || pdfPath,
        workout_plan,
        nutrition_plan,
        notes: coach_note || null
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(week_no),
        coach_note || `Week ${week_no} program is ready!`
      ],
      media: publicUrl?.publicUrl ? {
        url: publicUrl.publicUrl,
        filename: `week_${week_no}_program.pdf`
      } : {}
    });

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      ok: true,
      program_id: program.id,
      pdf_url: publicUrl?.publicUrl || pdfPath
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
