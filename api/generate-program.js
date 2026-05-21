const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|steroid/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*(in|per)\s*(a\s*)?week/i,
  /extreme\s*cut/i
];

function hasDangerousContent(text) {
  return RISKY_PATTERNS.some(p => p.test(text));
}

async function generateProgramContent(client, checkins) {
  const anthropic = new Anthropic();

  const clientSummary = `
Client: ${client.name || 'Anonymous'}
Program: ${client.program}
Week: ${checkins.length > 0 ? checkins[0].week_no + 1 : 1}
`;

  const checkinHistory = checkins.map(c => `
Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm,
Compliance=${c.compliance_score}/10, Energy=${c.energy}/10
Issues: ${c.issues || 'None'}
Focus: ${c.next_week_focus || 'N/A'}
`).join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are a NASM-certified fitness program architect for "Fitness by Maddy."
Design the next week's program for this client.

${clientSummary}

Recent check-in history:
${checkinHistory || 'No check-ins yet (Week 1)'}

Output STRICT JSON with this structure:
{
  "workout_plan": {
    "days": [
      {"day": "Monday", "focus": "Upper Body", "exercises": [
        {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
      ]},
      ...
    ],
    "cardio": {"type": "", "frequency": "", "duration": ""},
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": [],
    "hydration": "",
    "supplements": []
  },
  "coach_notes": ""
}

Rules:
- Science-backed, progressive overload principles
- Never prescribe under 1400 kcal for women or 1600 kcal for men
- No banned substances or unrealistic timelines
- Warm + expert tone. Never bro-sciency.
- Factor in reported compliance and energy levels`
    }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75);

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    doc.fontSize(20).fill('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (program.workout_plan && program.workout_plan.days) {
      for (const day of program.workout_plan.days) {
        doc.fontSize(14).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, { underline: true });
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  ${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`);
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (program.workout_plan && program.workout_plan.cardio) {
      const c = program.workout_plan.cardio;
      doc.fontSize(12).fill('#2C2C2C').text('Cardio');
      doc.fontSize(10).fill('#6B6B6B')
        .text(`  ${c.type} | ${c.frequency} | ${c.duration}`);
      doc.moveDown();
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(20).fill('#B8965A').text('NUTRITION PLAN', 50, 30);

    doc.moveDown(2);
    doc.fill('#2C2C2C');

    if (program.nutrition_plan) {
      const n = program.nutrition_plan;
      doc.fontSize(14).text('Daily Targets');
      doc.fontSize(11).fill('#6B6B6B')
        .text(`Calories: ${n.calories} kcal`)
        .text(`Protein: ${n.protein_g}g | Carbs: ${n.carbs_g}g | Fats: ${n.fats_g}g`);
      doc.moveDown();

      if (n.meal_timing && n.meal_timing.length > 0) {
        doc.fontSize(14).fill('#2C2C2C').text('Meal Timing');
        for (const meal of n.meal_timing) {
          doc.fontSize(10).fill('#6B6B6B').text(`  ${meal}`);
        }
        doc.moveDown();
      }

      if (n.hydration) {
        doc.fontSize(11).fill('#6B6B6B').text(`Hydration: ${n.hydration}`);
      }

      if (n.supplements && n.supplements.length > 0) {
        doc.moveDown();
        doc.fontSize(14).fill('#2C2C2C').text('Supplements');
        for (const s of n.supplements) {
          doc.fontSize(10).fill('#6B6B6B').text(`  ${s}`);
        }
      }
    }

    if (program.coach_notes) {
      doc.moveDown();
      doc.fontSize(14).fill('#B8965A').text("Coach's Notes");
      doc.fontSize(11).fill('#6B6B6B').text(program.coach_notes);
    }

    doc.moveDown(2);
    doc.fontSize(9).fill('#C8B89A')
      .text('fitnessbymaddy.com | This program is personalised and confidential.', { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });

    const supabase = getClient();

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const targetWeek = week_no || 1;

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const program = await generateProgramContent(client, checkins || []);
    const rawText = JSON.stringify(program);

    if (hasDangerousContent(rawText)) {
      const { notifyMaddy } = require('../lib/escalation');
      await notifyMaddy(supabase, 'Program flagged for safety review', {
        phone: maskPhone(client.phone),
        week: targetWeek,
        flag: 'Dangerous content detected in generated program'
      });
      return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, targetWeek, program);
    const pdfPath = `clients/${client_id}/week_${targetWeek}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from('client-data')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
      return res.status(500).json({ error: 'PDF upload failed' });
    }

    const { data: urlData } = supabase.storage
      .from('client-data')
      .getPublicUrl(pdfPath);

    const { data: programRecord } = await supabase.from('programs').insert({
      client_id,
      week_no: targetWeek,
      pdf_url: urlData.publicUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.coach_notes
    }).select().single();

    await sendTemplate(supabase, client.phone, 'weekly_program', {
      name: client.name || 'there',
      week: String(targetWeek),
      pdf_url: urlData.publicUrl,
      note: program.coach_notes || 'New week, new gains!'
    });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', programRecord.id);

    console.log(`Program generated: ${maskPhone(client.phone)}, week ${targetWeek}`);
    return res.status(200).json({ ok: true, program_id: programRecord.id, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
