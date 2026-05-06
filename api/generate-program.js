const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { corsHeaders, maskPhone } = require('../lib/utils');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'steroids', 'anabolic',
  'lose 20 pounds in a week', 'extreme fasting'
];

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) {
      await notifyMaddy(
        'Program generation failed',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nCould not parse Claude response`
      );
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programData = JSON.parse(jsonMatch[1]);

    const contentStr = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => contentStr.includes(f));
    if (flagged) {
      await notifyMaddy(
        'SAFETY FLAG - Program halted',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nProgram flagged for unsafe content. Manual review required.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    const { data: programRecord, error: insertError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: publicUrl?.publicUrl || pdfPath,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.notes || ''
      })
      .select()
      .single();

    if (insertError) throw insertError;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      programData.notes || 'Your new program is ready!'
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', programRecord.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ ok: true, program_id: programRecord.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'None'}`
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program} (Week ${weekNo} of ${client.program === '12wk' ? 12 : 6})
- Start date: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

${lastProgram ? `LAST WEEK'S PROGRAM NOTES: ${lastProgram.notes || 'None'}` : ''}

INSTRUCTIONS:
- Create a progressive, science-based program for Week ${weekNo}
- Adjust based on compliance, energy levels, and any reported issues
- Include 4-5 training days with specific exercises, sets, reps, and rest
- Include a full nutrition plan with macros and meal suggestions
- Be warm and motivating but never bro-sciency or over-promising
- NEVER suggest extreme calorie cuts, banned substances, or unrealistic timelines
- If client reported pain or medical issues, recommend consulting a doctor

Output ONLY a JSON block in this exact format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "3x per week, 20min LISS or 15min HIIT",
    "rest_days": "Wednesday and Sunday"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "suggestion": "Oats with whey, banana, and almonds" }
    ],
    "hydration": "3-4 liters per day",
    "supplements": "Whey protein, creatine monohydrate 5g, vitamin D3"
  },
  "notes": "One-liner motivational context for this week"
}
\`\`\``;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 25, { align: 'left' });
    doc.fontSize(12).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 55, { align: 'left' });
    doc.fontSize(10).fillColor('#B8965A')
      .text(client.name || 'Client', 400, 30, { align: 'right' });
    doc.fontSize(9).fillColor('#999999')
      .text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), 400, 45, { align: 'right' });

    doc.moveDown(3);

    // Workout section
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#2C2C2C')
      .text('WORKOUT PLAN');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(0.5);

    const wp = programData.workout_plan;
    if (wp?.days) {
      for (const day of wp.days) {
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#B8965A')
          .text(day.day);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).font('Helvetica').fillColor('#2C2C2C')
              .text(`  ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  (' + ex.notes + ')' : ''}`, {
                indent: 10
              });
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (wp?.cardio) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#2C2C2C')
        .text(`Cardio: ${wp.cardio}`);
    }
    if (wp?.rest_days) {
      doc.fontSize(10).font('Helvetica').fillColor('#666666')
        .text(`Rest Days: ${wp.rest_days}`);
    }

    doc.moveDown(1.5);

    // Nutrition section
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#2C2C2C')
      .text('NUTRITION PLAN');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(0.5);

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#2C2C2C')
        .text(`Daily Targets: ${np.calories} cal  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fat_g}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#B8965A')
            .text(meal.meal, { continued: true })
            .font('Helvetica').fillColor('#2C2C2C')
            .text(`  —  ${meal.suggestion}`);
        }
      }
      doc.moveDown(0.5);

      if (np.hydration) {
        doc.fontSize(10).font('Helvetica').fillColor('#666666')
          .text(`Hydration: ${np.hydration}`);
      }
      if (np.supplements) {
        doc.fontSize(10).font('Helvetica').fillColor('#666666')
          .text(`Supplements: ${np.supplements}`);
      }
    }

    // Footer
    const footerY = doc.page.height - 60;
    doc.rect(0, footerY, doc.page.width, 60).fill('#2C2C2C');
    doc.fontSize(8).font('Helvetica').fillColor('#B8965A')
      .text('fitnessbymaddy.com  |  @fitnessbymaddy', 50, footerY + 20, { align: 'center', width: doc.page.width - 100 });
    doc.fontSize(7).fillColor('#666666')
      .text('This program is personalized. Do not share. Consult a physician before starting any exercise program.', 50, footerY + 35, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}
