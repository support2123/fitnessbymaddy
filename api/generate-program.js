const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const supabase = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const UNSAFE_PATTERNS = [
  /below\s*\d{3,4}\s*cal/i,
  /steroid/i, /sarm/i, /clenbuterol/i, /dnp/i, /ephedra/i,
  /lose\s*\d+\s*kg\s*in\s*\d+\s*day/i,
  /crash\s*diet/i, /extreme\s*cut/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('first_msg').eq('id', client.lead_id).maybeSingle()
      : { data: null };

    let intakeData = null;
    if (lead?.first_msg?.includes('---INTAKE---')) {
      try {
        intakeData = JSON.parse(lead.first_msg.split('---INTAKE---')[1]);
      } catch (e) {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified personal trainer and nutrition coach creating a weekly program for a client. You must output valid JSON only.

Your response must be a JSON object with exactly these keys:
- workout_plan: object with days (day_1 through day_6, day_7 is rest) each containing exercise name, sets, reps, rest, and notes
- nutrition_plan: object with daily_calories, protein_g, carbs_g, fat_g, meal_1 through meal_5 (each with name, items array, and approximate calories)
- weekly_note: a short motivational + instructional note (2-3 sentences)

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- Never mention banned substances, steroids, SARMs, or extreme protocols
- Base progressions on the client's recent check-in data
- Be specific with exercise names and rep ranges
- Include warm-up and cool-down in day structure`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Unknown'}
Program: ${client.program}
${intakeData ? `
Profile:
- Age: ${intakeData.age || 'N/A'}
- Gender: ${intakeData.gender || 'N/A'}
- Height: ${intakeData.height || 'N/A'}
- Weight: ${intakeData.weight || 'N/A'}
- Goal: ${intakeData.goal || 'N/A'}
- Injuries: ${intakeData.injuries || 'None'}
- Diet: ${intakeData.diet_preference || 'No restrictions'}
- Equipment: ${intakeData.equipment_access || 'Full gym'}
- Schedule: ${intakeData.workout_schedule || 'Flexible'}
- Medical: ${intakeData.medical_conditions || 'None'}` : ''}

${checkins && checkins.length > 0 ? `Recent check-ins:
${checkins.map(c => `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins (first week).'}

Output valid JSON only.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const rawText = response.content[0].text;

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(rawText)) {
        const { escalate } = require('./_lib/escalation');
        await escalate(client.phone, 'unsafe_program_content', `Pattern matched in Week ${week_no} generation`);
        return res.status(422).json({ error: 'Program flagged for review', reason: 'safety' });
      }
    }

    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (e) {
      return res.status(422).json({ error: 'Failed to parse program JSON' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('client-files').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = supabase.storage.from('client-files').getPublicUrl(filePath);

    await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: urlData.publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_note,
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      programData.weekly_note || 'Your new program is ready!',
      urlData.publicUrl,
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.json({
      success: true,
      pdf_url: urlData.publicUrl,
      week_no,
    });
  } catch (err) {
    console.error('Generate program error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 70);
    doc.fill('#D4AF7A').fontSize(11)
      .text(`${client.name || 'Client'} | ${client.program}`, 50, 90);

    doc.moveDown(3);
    let y = 150;

    // Workout Plan
    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    const wp = programData.workout_plan;
    if (wp) {
      for (const [day, exercises] of Object.entries(wp)) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fill('#B8965A').fontSize(13).font('Helvetica-Bold')
          .text(day.replace(/_/g, ' ').toUpperCase(), 50, y);
        y += 20;

        if (typeof exercises === 'string') {
          doc.fill('#2C2C2C').fontSize(10).font('Helvetica').text(exercises, 70, y, { width: 470 });
          y += 20;
        } else if (Array.isArray(exercises)) {
          for (const ex of exercises) {
            const line = typeof ex === 'string' ? ex : `${ex.name || ex.exercise || ''} - ${ex.sets || ''}x${ex.reps || ''} (Rest: ${ex.rest || '60s'})`;
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica').text(`  ${line}`, 70, y, { width: 470 });
            y += 16;
          }
        } else if (typeof exercises === 'object') {
          for (const [key, val] of Object.entries(exercises)) {
            const line = typeof val === 'string' ? val : `${val.name || val.exercise || key} - ${val.sets || ''}x${val.reps || ''} (Rest: ${val.rest || '60s'})`;
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica').text(`  ${line}`, 70, y, { width: 470 });
            y += 16;
          }
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    y += 20;
    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    const np = programData.nutrition_plan;
    if (np) {
      doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold')
        .text(`Daily Targets: ${np.daily_calories || '?'} kcal | P: ${np.protein_g || '?'}g | C: ${np.carbs_g || '?'}g | F: ${np.fat_g || '?'}g`, 50, y);
      y += 25;

      for (const [key, meal] of Object.entries(np)) {
        if (key.startsWith('meal_') || key.startsWith('Meal')) {
          if (y > 700) { doc.addPage(); y = 50; }

          const mealName = typeof meal === 'object' ? (meal.name || key) : key;
          doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold').text(mealName.toUpperCase(), 70, y);
          y += 16;

          if (typeof meal === 'object') {
            const items = meal.items || [];
            for (const item of items) {
              doc.fill('#6B6B6B').fontSize(10).font('Helvetica').text(`  - ${item}`, 85, y, { width: 440 });
              y += 14;
            }
            if (meal.approximate_calories || meal.calories) {
              doc.fill('#B8965A').fontSize(9).font('Helvetica').text(`  ~${meal.approximate_calories || meal.calories} kcal`, 85, y);
              y += 14;
            }
          }
          y += 6;
        }
      }
    }

    // Weekly Note
    if (programData.weekly_note) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.rect(50, y, doc.page.width - 100, 2).fill('#B8965A');
      y += 15;
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica-Oblique')
        .text(programData.weekly_note, 50, y, { width: doc.page.width - 100 });
    }

    // Footer
    const lastPage = doc.bufferedPageRange();
    doc.fill('#C8B89A').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | Confidential - For client use only', 50, doc.page.height - 40, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}
