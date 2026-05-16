const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 calories', 'below 800',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) return res.status(400).json({ error: 'Missing params' });

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const { data: lead } = await supabase
      .from('leads')
      .select('intake_data')
      .eq('id', client.lead_id)
      .single();

    const prompt = buildProgramPrompt(client, checkins || [], prevProgram, lead?.intake_data, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    let programData;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                        content.match(/\{[\s\S]*"workout_plan"[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      programData = JSON.parse(jsonStr);
    } catch (e) {
      console.error('Failed to parse program JSON');
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.find(flag => fullText.includes(flag));
    if (flagged) {
      await escalateToMaddy('Safety flag in generated program', {
        clientName: client.name,
        phone: client.phone,
        details: `Flagged: "${flagged}" in Week ${week_no}`
      });
      return res.json({ halted: true, reason: `Safety flag: ${flagged}` });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || null
    }).select().single();

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(week_no),
        programData.coach_note || 'Keep pushing!'
      ],
      media: {
        url: urlData?.publicUrl,
        filename: `Week_${week_no}_Program.pdf`
      }
    });

    if (program) {
      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    return res.json({ success: true, programId: program?.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, prevProgram, intakeData, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let intakeSection = '';
  if (intakeData) {
    intakeSection = `
INTAKE PROFILE:
- Age: ${intakeData.age || 'N/A'}
- Gender: ${intakeData.gender || 'N/A'}
- Goal: ${intakeData.goal || 'N/A'}
- Injuries: ${intakeData.injuries || 'None'}
- Diet preference: ${intakeData.diet_preference || 'N/A'}
- Schedule: ${intakeData.schedule || 'N/A'}
- Medical conditions: ${intakeData.medical_conditions || 'None'}
- Fitness level: ${intakeData.current_fitness_level || 'N/A'}`;
  }

  return `You are a certified fitness program architect for FitnessByMaddy.

Generate a Week ${weekNo} personalized training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intakeSection}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10` : ''}

${prevProgram ? `PREVIOUS PROGRAM NOTES: ${prevProgram.notes || 'None'}` : ''}

RULES:
- Safe, evidence-based programs only
- Minimum 1200 kcal for women, 1500 for men
- No banned substances
- Progressive overload when previous data is available
- Include rest days
- Be specific: sets, reps, RPE/RIR targets

Return ONLY valid JSON:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }] }
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "sample_meals": ["..."],
    "hydration": "...",
    "supplements": ["..."]
  },
  "coach_note": "Brief personalized note (1-2 sentences)"
}
\`\`\``;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#ffffff').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 70, { align: 'center' });
    doc.fill('#B8965A').fontSize(10)
      .text(client.name || 'Client', 50, 92, { align: 'center' });

    // Workout Plan
    let y = 150;
    doc.fill('#1a1a1a').fontSize(18).font('Helvetica-Bold').text('WORKOUT PLAN', 50, y);
    doc.moveTo(50, y + 22).lineTo(545, y + 22).stroke('#B8965A');
    y += 35;

    const wp = programData.workout_plan;
    if (wp && wp.days) {
      for (const day of wp.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fill('#B8965A').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            const line = `${ex.name}: ${ex.sets} sets x ${ex.reps} | Rest: ${ex.rest || '60s'}${ex.notes ? ' — ' + ex.notes : ''}`;
            doc.fill('#333333').fontSize(10).font('Helvetica').text('  ' + line, 60, y, { width: 480 });
            y += 16;
          }
        }
        y += 10;
      }

      if (wp.cardio) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fill('#1a1a1a').fontSize(11).font('Helvetica-Bold').text('Cardio:', 50, y);
        y += 16;
        doc.fill('#333333').fontSize(10).font('Helvetica').text(wp.cardio, 60, y, { width: 480 });
        y += 24;
      }

      if (wp.rest_days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fill('#1a1a1a').fontSize(11).font('Helvetica-Bold').text('Rest Days:', 50, y);
        y += 16;
        doc.fill('#333333').fontSize(10).font('Helvetica').text(wp.rest_days, 60, y, { width: 480 });
        y += 24;
      }
    }

    // Nutrition Plan
    doc.addPage();
    y = 50;
    doc.fill('#1a1a1a').fontSize(18).font('Helvetica-Bold').text('NUTRITION PLAN', 50, y);
    doc.moveTo(50, y + 22).lineTo(545, y + 22).stroke('#B8965A');
    y += 40;

    const np = programData.nutrition_plan;
    if (np) {
      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('Daily Targets', 50, y);
      y += 20;

      const targets = [
        `Calories: ${np.calories || 'TBD'} kcal`,
        `Protein: ${np.protein_g || 'TBD'}g`,
        `Carbs: ${np.carbs_g || 'TBD'}g`,
        `Fats: ${np.fats_g || 'TBD'}g`
      ];
      for (const t of targets) {
        doc.fill('#333333').fontSize(10).font('Helvetica').text('  ' + t, 60, y);
        y += 16;
      }
      y += 10;

      if (np.meal_timing) {
        doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('Meal Timing', 50, y);
        y += 18;
        doc.fill('#333333').fontSize(10).font('Helvetica').text(np.meal_timing, 60, y, { width: 480 });
        y += 30;
      }

      if (np.sample_meals && np.sample_meals.length > 0) {
        doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('Sample Meals', 50, y);
        y += 18;
        for (const meal of np.sample_meals) {
          doc.fill('#333333').fontSize(10).font('Helvetica').text('  ' + meal, 60, y, { width: 480 });
          y += 16;
        }
        y += 10;
      }

      if (np.hydration) {
        doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('Hydration', 50, y);
        y += 18;
        doc.fill('#333333').fontSize(10).font('Helvetica').text(np.hydration, 60, y, { width: 480 });
        y += 30;
      }

      if (np.supplements && np.supplements.length > 0) {
        doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('Supplements', 50, y);
        y += 18;
        for (const sup of np.supplements) {
          doc.fill('#333333').fontSize(10).font('Helvetica').text('  ' + sup, 60, y);
          y += 16;
        }
      }
    }

    // Coach Note
    if (programData.coach_note) {
      y += 30;
      if (y > 700) { doc.addPage(); y = 50; }
      doc.rect(40, y, doc.page.width - 80, 60).fill('#FFF8F0');
      doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold')
        .text('Note from Coach Maddy:', 55, y + 10);
      doc.fill('#333333').fontSize(10).font('Helvetica')
        .text(programData.coach_note, 55, y + 28, { width: 460 });
    }

    // Footer on all pages
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fill('#999999').fontSize(8).font('Helvetica')
        .text('fitnessbymaddy.com', 50, doc.page.height - 30, { align: 'center' });
    }

    doc.end();
  });
}
