const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone, notifyMaddy } = require('./lib/whatsapp');
const { logMessage } = require('./lib/ratelimit');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /extreme\s*calori/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp|dinitrophenol/i,
  /anabolic\s*steroid/i,
  /ephedra/i,
  /sarm/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i,
];

function isSafeProgram(text) {
  return !UNSAFE_PATTERNS.some(p => p.test(text));
}

async function generateWithClaude(client, checkins) {
  const anthropic = new Anthropic();

  const clientProfile = `
Client: ${client.name || 'Anonymous'}
Program: ${client.program}
Started: ${client.program_started_at}
`;

  const recentCheckins = checkins.map(c => `
Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm,
Compliance=${c.compliance_score}/10, Energy=${c.energy}/10
Issues: ${c.issues || 'None'}
Focus: ${c.next_week_focus || 'General progress'}
`).join('\n');

  const nextWeek = checkins.length > 0 ? Math.max(...checkins.map(c => c.week_no)) + 1 : 1;

  const prompt = `You are an elite fitness program architect for FitnessByMaddy — a NASM-certified trainer.

Design Week ${nextWeek} training and nutrition plan for this client:

${clientProfile}

Recent check-in data:
${recentCheckins || 'No previous check-ins (Week 1)'}

Requirements:
- 5-6 training days per week (progressive overload)
- Nutrition: calculated macros, meal timing, hydration
- Adapt based on compliance/energy scores
- Include warm-up/cool-down protocols
- Be specific: exact exercises, sets, reps, rest periods
- Nutrition: provide macro targets + 1 sample day with meals

Output as valid JSON:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Push",
        "warmup": "...",
        "exercises": [{"name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "..."}],
        "cooldown": "..."
      }
    ],
    "weekly_volume_notes": "..."
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fats_g": 65,
    "meal_timing": "...",
    "hydration": "...",
    "sample_day": {
      "meals": [{"time": "7am", "meal": "...", "macros": "..."}]
    },
    "supplements": "..."
  },
  "coach_notes": "Brief 2-line context for this week's adjustments"
}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0].text;

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  if (!isSafeProgram(responseText)) {
    throw new Error('SAFETY_FLAG: Program contains potentially unsafe recommendations');
  }

  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(programData, client, weekNo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(28).font('Helvetica-Bold')
      .fillColor('#2C2C2C')
      .text('FITNESS BY MADDY', 50, 50);

    doc.fontSize(10).font('Helvetica')
      .fillColor('#B8965A')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 85);

    doc.moveTo(50, 105).lineTo(545, 105).strokeColor('#E8E3DC').stroke();

    // Client info
    doc.fontSize(12).font('Helvetica')
      .fillColor('#6B6B6B')
      .text(`Client: ${client.name || 'Client'}`, 50, 120)
      .text(`Program: ${client.program}`, 50, 138)
      .text(`Week: ${weekNo}`, 50, 156);

    let y = 185;

    // Nutrition summary
    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#2C2C2C')
        .text('NUTRITION', 50, y);
      y += 25;

      doc.fontSize(11).font('Helvetica').fillColor('#6B6B6B')
        .text(`Calories: ${np.calories} | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fats: ${np.fats_g}g`, 50, y);
      y += 20;

      if (np.hydration) {
        doc.text(`Hydration: ${np.hydration}`, 50, y);
        y += 20;
      }
      y += 10;
    }

    // Workout plan
    const wp = programData.workout_plan;
    if (wp && wp.days) {
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#2C2C2C')
        .text('TRAINING', 50, y);
      y += 25;

      for (const day of wp.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).font('Helvetica-Bold').fillColor('#B8965A')
          .text(day.day, 50, y);
        y += 20;

        if (day.warmup) {
          doc.fontSize(10).font('Helvetica').fillColor('#6B6B6B')
            .text(`Warm-up: ${day.warmup}`, 60, y);
          y += 15;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            doc.fontSize(10).font('Helvetica').fillColor('#2C2C2C')
              .text(`• ${ex.name} — ${ex.sets}×${ex.reps} (rest: ${ex.rest})`, 60, y);
            y += 14;
            if (ex.notes) {
              doc.fontSize(9).fillColor('#6B6B6B').text(`  ${ex.notes}`, 70, y);
              y += 12;
            }
          }
        }
        y += 10;
      }
    }

    // Coach notes
    if (programData.coach_notes) {
      if (y > 700) { doc.addPage(); y = 50; }
      y += 10;
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#2C2C2C')
        .text('COACH NOTES', 50, y);
      y += 20;
      doc.fontSize(10).font('Helvetica').fillColor('#6B6B6B')
        .text(programData.coach_notes, 50, y, { width: 495 });
    }

    // Footer
    doc.fontSize(8).font('Helvetica').fillColor('#C8B89A')
      .text('© Fitness by Maddy | fitnessbymaddy.com', 50, 780, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let programData;
    try {
      programData = await generateWithClaude(client, checkins || []);
    } catch (genErr) {
      if (genErr.message.startsWith('SAFETY_FLAG')) {
        await notifyMaddy(
          'Program Safety Flag',
          `Client ${client.name || maskPhone(client.phone)} week ${week_no}: AI generated potentially unsafe content. Review needed.`
        );
        return res.status(422).json({ error: 'Program flagged for safety review' });
      }
      throw genErr;
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr);
    }

    const { data: urlData } = db.storage.from('clients').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program, error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes,
    }).select().single();

    if (insertErr) {
      console.error('Program insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    try {
      await sendTemplate(client.phone, 'program_delivery', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(week_no),
          programData.coach_notes || 'Your new week plan is ready!',
        ],
        media: { url: pdfUrl, filename: `week_${week_no}_program.pdf` },
      });

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('id', program.id);

      await logMessage(client.phone, 'out', `Week ${week_no} program PDF sent`, 'program_delivery');
    } catch (sendErr) {
      console.error(`Program delivery failed for ${maskPhone(client.phone)}:`, sendErr.message);
    }

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Generate program error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
