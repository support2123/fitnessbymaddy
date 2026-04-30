const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'below 800 cal',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'crash diet', 'starvation',
];

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

    const { data: intakeBlob } = await db.storage
      .from('clients')
      .download(`intakes/${client.lead_id}.json`);

    let intakeData = null;
    if (intakeBlob) {
      try {
        intakeData = JSON.parse(await intakeBlob.text());
      } catch (_) {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect working for FitnessByMaddy.
Create a personalized weekly training and nutrition plan.

RULES:
- Programs must be safe and evidence-based
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 kcal for men)
- Never recommend banned substances or supplements without strong evidence
- Never promise unrealistic timelines
- Consider any injuries, medical conditions, or limitations
- Adjust based on previous check-in compliance and energy levels
- Output MUST be valid JSON with "workout_plan" and "nutrition_plan" keys`;

    const userPrompt = buildPrompt(client, intakeData, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0]?.text || '';

    for (const flag of SAFETY_FLAGS) {
      if (responseText.toLowerCase().includes(flag)) {
        await db.from('escalations').insert({
          phone: client.phone,
          reason: `Safety flag in program generation: "${flag}"`,
          message_body: `Week ${week_no} program for client ${client_id} flagged.`,
        });
        return res.status(200).json({
          action: 'flagged_for_review',
          flag,
          client_id,
        });
      }
    }

    let plans;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      plans = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (_) {
      plans = { workout_plan: { raw: responseText }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, plans, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: plans.workout_plan,
      nutrition_plan: plans.nutrition_plan,
      notes: plans.notes || null,
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'Champion',
      String(week_no),
      pdfUrl,
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ action: 'generated', client_id, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  let prompt = `Create Week ${weekNo} program for client:\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `\nIntake data:\n`;
    if (intake.age) prompt += `Age: ${intake.age}\n`;
    if (intake.gender) prompt += `Gender: ${intake.gender}\n`;
    if (intake.goal) prompt += `Goal: ${intake.goal}\n`;
    if (intake.injuries) prompt += `Injuries/limitations: ${intake.injuries}\n`;
    if (intake.diet_pref) prompt += `Diet preference: ${intake.diet_pref}\n`;
    if (intake.schedule) prompt += `Training schedule: ${intake.schedule}\n`;
    if (intake.experience) prompt += `Experience: ${intake.experience}\n`;
    if (intake.medical_conditions) prompt += `Medical conditions: ${intake.medical_conditions}\n`;
    if (intake.current_weight) prompt += `Current weight: ${intake.current_weight}kg\n`;
    if (intake.target_weight) prompt += `Target weight: ${intake.target_weight}kg\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, `;
      prompt += `compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      if (c.next_week_focus) prompt += `, focus: ${c.next_week_focus}`;
      prompt += `\n`;
    }
  }

  prompt += `\nReturn valid JSON with keys: "workout_plan" (object with days as keys, each day has "exercises" array with {name, sets, reps, rest, notes}), "nutrition_plan" (object with calories, protein_g, carbs_g, fat_g, meal_plan array), and optional "notes" string.`;

  return prompt;
}

function generatePDF(client, plans, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 3 });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 75);
    doc.fontSize(10).fillColor('#D4AF7A')
      .text(`Prepared for ${client.name || 'Client'}`, 50, 95);

    doc.moveDown(4);

    doc.fontSize(18).fillColor('#2C2C2C')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y + 5).lineTo(545, doc.y + 5).stroke('#B8965A');
    doc.moveDown();

    const workout = plans.workout_plan || {};
    for (const [day, data] of Object.entries(workout)) {
      if (day === 'raw') {
        doc.fontSize(10).fillColor('#333').text(String(data).substring(0, 2000), 50);
        continue;
      }

      doc.fontSize(13).fillColor('#B8965A').text(day.toUpperCase(), 50);
      doc.moveDown(0.3);

      const exercises = data.exercises || data;
      if (Array.isArray(exercises)) {
        for (const ex of exercises) {
          const line = typeof ex === 'string' ? ex :
            `${ex.name || 'Exercise'} — ${ex.sets || '3'}x${ex.reps || '12'} (Rest: ${ex.rest || '60s'})`;
          doc.fontSize(10).fillColor('#333').text(`  ${line}`, 60);
          if (ex.notes) {
            doc.fontSize(8).fillColor('#888').text(`    ${ex.notes}`, 70);
          }
        }
      }
      doc.moveDown(0.5);

      if (doc.y > 700) doc.addPage();
    }

    doc.addPage();

    doc.fontSize(18).fillColor('#2C2C2C')
      .text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y + 5).lineTo(545, doc.y + 5).stroke('#B8965A');
    doc.moveDown();

    const nutrition = plans.nutrition_plan || {};
    if (nutrition.calories) {
      doc.fontSize(12).fillColor('#2C2C2C')
        .text('Daily Targets', 50);
      doc.fontSize(10).fillColor('#333')
        .text(`Calories: ${nutrition.calories} kcal`, 60)
        .text(`Protein: ${nutrition.protein_g || '—'}g`, 60)
        .text(`Carbs: ${nutrition.carbs_g || '—'}g`, 60)
        .text(`Fat: ${nutrition.fat_g || '—'}g`, 60);
      doc.moveDown();
    }

    if (Array.isArray(nutrition.meal_plan)) {
      doc.fontSize(12).fillColor('#2C2C2C').text('Meal Plan', 50);
      doc.moveDown(0.3);
      for (const meal of nutrition.meal_plan) {
        const text = typeof meal === 'string' ? meal :
          `${meal.name || 'Meal'}: ${meal.description || meal.foods || ''}`;
        doc.fontSize(10).fillColor('#333').text(`  ${text}`, 60);
      }
    }

    if (plans.notes) {
      doc.moveDown();
      doc.fontSize(12).fillColor('#2C2C2C').text('Coach Notes', 50);
      doc.fontSize(10).fillColor('#555').text(plans.notes, 60);
    }

    doc.moveDown(3);
    doc.fontSize(8).fillColor('#999')
      .text('Generated by FitnessByMaddy Coaching System', 50, doc.page.height - 50, { align: 'center' });

    doc.end();
  });
}
