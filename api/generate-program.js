const { supabase } = require('./_lib/supabase');
const { sendText } = require('./_lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarms/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) return res.status(400).json({ error: 'client_id and week_no required' });

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

    const { data: leadData } = await supabase
      .from('leads')
      .select('first_msg')
      .eq('id', client.lead_id)
      .single();

    let intakeProfile = {};
    try { intakeProfile = JSON.parse(leadData?.first_msg || '{}'); } catch {}

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
Create a weekly training and nutrition plan. Output valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "LISS", "duration": "30min", "frequency": "3x/week" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 65,
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "options": ["4 eggs + 2 toast + avocado", "Oats + whey + banana"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "notes": "Focus on progressive overload this week."
}

SAFETY RULES — NEVER recommend:
- Under 1200 calories for any client
- Banned substances (clenbuterol, DNP, ephedra, SARMs)
- More than 1kg/2lb loss per week as a target
- Extreme fasting protocols for beginners`;

    const userPrompt = `Client profile:
- Program: ${client.program}
- Week: ${week_no}
- Name: ${client.name || 'Client'}
${intakeProfile.goal ? `- Goal: ${intakeProfile.goal}` : ''}
${intakeProfile.age ? `- Age: ${intakeProfile.age}` : ''}
${intakeProfile.weight ? `- Starting weight: ${intakeProfile.weight}` : ''}
${intakeProfile.injuries ? `- Injuries/limitations: ${intakeProfile.injuries}` : ''}
${intakeProfile.diet_pref ? `- Diet preference: ${intakeProfile.diet_pref}` : ''}
${intakeProfile.schedule ? `- Available schedule: ${intakeProfile.schedule}` : ''}
${intakeProfile.experience ? `- Experience: ${intakeProfile.experience}` : ''}

Recent check-ins:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues: ${c.issues || 'none'}`).join('\n')
  : 'No previous check-ins (first week)'}

Generate Week ${week_no} program. JSON only, no markdown.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawContent = response.content[0].text;
    let programData;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program from Claude' });
    }

    const contentStr = JSON.stringify(programData);
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(contentStr)) {
        await supabase.from('programs').insert({
          client_id, week_no,
          workout_plan: programData.workout_plan,
          nutrition_plan: programData.nutrition_plan,
          notes: 'FLAGGED FOR REVIEW — unsafe content detected'
        });
        return res.status(200).json({ status: 'flagged_for_review' });
      }
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('client-files').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || null
    }).select().single();

    const contextNote = programData.notes || `Week ${week_no} program is ready!`;
    await sendText(client.phone, `Your Week ${week_no} program is ready!\n\n${contextNote}\n\nPDF: ${pdfUrl}`);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ status: 'generated', program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { width: doc.page.width - 100 });
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75);
    doc.fill('#B8965A').fontSize(10)
      .text(client.program?.toUpperCase().replace(/_/g, ' ') || '', 50, 95);

    doc.moveDown(4);

    doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke('#B8965A');
    doc.moveDown(0.5);

    const workout = programData.workout_plan;
    if (workout?.days) {
      for (const day of workout.days) {
        doc.fill('#2C2C2C').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}${ex.notes ? `  |  ${ex.notes}` : ''}`, 60);
          }
        }
        doc.moveDown(0.5);

        if (doc.y > 700) doc.addPage();
      }
    }

    if (workout?.cardio) {
      doc.moveDown(0.5);
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold').text('Cardio:', 50);
      doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
        .text(`  ${workout.cardio.type} — ${workout.cardio.duration}, ${workout.cardio.frequency}`, 60);
    }

    doc.addPage();

    doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke('#B8965A');
    doc.moveDown(0.5);

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold').text('Daily Targets:', 50);
      doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
        .text(`  Calories: ${nutrition.calories || '—'}  |  Protein: ${nutrition.protein_g || '—'}g  |  Carbs: ${nutrition.carbs_g || '—'}g  |  Fat: ${nutrition.fat_g || '—'}g`, 60);
      doc.moveDown(0.5);

      if (nutrition.meals) {
        doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold').text('Meals:', 50);
        doc.moveDown(0.3);
        for (const meal of nutrition.meals) {
          doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold')
            .text(`  ${meal.meal} (${meal.time || ''})`, 60);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill('#6B6B6B').fontSize(10).font('Helvetica').text(`    — ${opt}`, 70);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (nutrition.supplements) {
        doc.moveDown(0.5);
        doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold').text('Supplements:', 50);
        for (const sup of nutrition.supplements) {
          doc.fill('#6B6B6B').fontSize(10).font('Helvetica').text(`  — ${sup}`, 60);
        }
      }

      if (nutrition.hydration) {
        doc.moveDown(0.3);
        doc.fill('#6B6B6B').fontSize(10).font('Helvetica').text(`  Hydration: ${nutrition.hydration}`, 60);
      }
    }

    if (programData.notes) {
      doc.moveDown(1);
      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('Coach Notes:', 50);
      doc.fill('#6B6B6B').fontSize(10).font('Helvetica').text(programData.notes, 60, undefined, { width: 480 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fill('#C8B89A').fontSize(8).font('Helvetica')
        .text('fitnessbymaddy.com', 50, doc.page.height - 30)
        .text(`Page ${i + 1} of ${pageCount}`, doc.page.width - 100, doc.page.height - 30, { align: 'right' });
    }

    doc.end();
  });
}
