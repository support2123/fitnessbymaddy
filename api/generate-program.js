const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy, maskPhone } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'sarms', 'steroids',
  'lose 10kg in a week', 'crash diet', 'water fast',
];

function checkSafety(text) {
  const lower = (text || '').toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

async function generatePDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 50, { align: 'center' });

    doc.fill('#D4AF7A').fontSize(12).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 90, { align: 'center' });

    doc.fill('#ffffff').fontSize(10)
      .text(`Client: ${client.name || 'Client'}`, 50, 120, { align: 'center' });

    let yPos = 160;

    doc.fill('#B8965A').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, yPos);
    yPos += 30;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (yPos > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); yPos = 50; }
        doc.fill('#D4AF7A').fontSize(13).font('Helvetica-Bold')
          .text(day.name || 'Day', 50, yPos);
        yPos += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (yPos > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); yPos = 50; }
            doc.fill('#ffffff').fontSize(10).font('Helvetica')
              .text(`  ${ex.name} — ${ex.sets}x${ex.reps} ${ex.rest || ''}`, 60, yPos);
            yPos += 16;
          }
        }
        yPos += 10;
      }
    } else {
      doc.fill('#ffffff').fontSize(10).font('Helvetica')
        .text(JSON.stringify(workout, null, 2).slice(0, 1500), 50, yPos, { width: 500 });
      yPos += 200;
    }

    if (yPos > 600) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); yPos = 50; }

    doc.fill('#B8965A').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, yPos);
    yPos += 30;

    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        if (yPos > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); yPos = 50; }
        doc.fill('#D4AF7A').fontSize(12).font('Helvetica-Bold')
          .text(meal.name || 'Meal', 50, yPos);
        yPos += 18;
        doc.fill('#ffffff').fontSize(10).font('Helvetica')
          .text(meal.description || '', 60, yPos, { width: 480 });
        yPos += 30;
      }
    } else {
      doc.fill('#ffffff').fontSize(10).font('Helvetica')
        .text(JSON.stringify(nutrition, null, 2).slice(0, 1500), 50, yPos, { width: 500 });
    }

    if (notes) {
      if (yPos > 650) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); yPos = 50; }
      yPos += 20;
      doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
        .text('COACH NOTES', 50, yPos);
      yPos += 22;
      doc.fill('#ffffff').fontSize(10).font('Helvetica')
        .text(notes, 50, yPos, { width: 500 });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const claude = new Anthropic();

    const systemPrompt = `You are a NASM-certified fitness program architect working for Fitness by Maddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Be evidence-based, no bro-science
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Adjust based on client feedback and compliance
- Consider injuries and limitations
- Keep plans realistic and sustainable
- Output ONLY valid JSON`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Program: ${client.program}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins.'}

${prevPrograms && prevPrograms.length > 0 ? `PREVIOUS WEEK PLAN SUMMARY:
Week ${prevPrograms[0].week_no} was the last program generated.` : ''}

Return a JSON object with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Exercise Name", "sets": 3, "reps": "10-12", "rest": "60s" }
        ]
      }
    ],
    "notes": "Weekly workout notes"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "Description with portions" }
    ],
    "notes": "Nutrition notes"
  },
  "coach_notes": "Personalized note for the client"
}`;

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    const safetyIssue = checkSafety(responseText);
    if (safetyIssue) {
      await notifyMaddy(
        'SAFETY FLAG in program generation',
        `Client ${maskPhone(client.phone)}, Week ${week_no}: "${safetyIssue}" detected. Program held for review.`
      );
      return res.status(422).json({
        error: 'Program flagged for safety review',
        flag: safetyIssue,
      });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      return res.status(500).json({ error: 'Failed to parse Claude response' });
    }

    const workout = parsed.workout_plan || parsed.workout || {};
    const nutrition = parsed.nutrition_plan || parsed.nutrition || {};
    const notes = parsed.coach_notes || parsed.notes || '';

    const pdfBuffer = await generatePDF(client, week_no, workout, nutrition, notes);

    const pdfPath = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: insertError } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no, 10),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workout,
      nutrition_plan: nutrition,
      notes,
    }, {
      onConflict: 'client_id,week_no',
    });

    if (insertError) throw insertError;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      notes.slice(0, 200) || 'Your new program is ready!',
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no, 10));

    return res.json({
      success: true,
      pdf_url: pdfUrl,
      week_no,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
