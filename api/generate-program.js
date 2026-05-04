const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const UNSAFE_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|anavar|sarms/i,
  /lose\s*\d+\s*kg\s*in\s*[1-3]\s*day/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const { data: checkins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: intake } = await supabase
    .from('intake_forms')
    .select('*')
    .eq('lead_id', client.lead_id)
    .single();

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a client. Output valid JSON with two keys: "workout_plan" and "nutrition_plan".

workout_plan should have keys for each training day (e.g., "day_1", "day_2") with exercises, sets, reps, rest periods.

nutrition_plan should include daily calorie target, macro split, and a sample meal plan.

Rules:
- Never prescribe below 1400 calories for women or 1600 for men
- Never recommend banned substances or extreme protocols
- Base progression on the client's check-in data
- Keep it evidence-based and sustainable`;

  const userPrompt = `Client Profile:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}

Intake Data:
${intake ? JSON.stringify(intake, null, 2) : 'Not available'}

Recent Check-ins:
${checkins && checkins.length > 0 ? JSON.stringify(checkins, null, 2) : 'First week - no check-ins yet'}

Generate the Week ${week_no} program. Return ONLY valid JSON.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const content = response.content[0].text;

  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(content)) {
      const { notifyMaddy } = require('./lib/whatsapp');
      await notifyMaddy(`UNSAFE PROGRAM FLAGGED for client ${client.name} (Week ${week_no}). Manual review required.`);
      return res.status(200).json({ action: 'flagged_for_review', reason: 'unsafe_content' });
    }
  }

  let programData;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    programData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to parse program JSON' });
  }

  const pdfBuffer = await generatePDF(client, week_no, programData);

  const filePath = `clients/${client_id}/week_${week_no}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('programs')
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (uploadError) {
    return res.status(500).json({ error: 'Failed to upload PDF' });
  }

  const { data: urlData } = supabase.storage
    .from('programs')
    .getPublicUrl(filePath);

  const pdfUrl = urlData.publicUrl;

  await supabase.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: `Auto-generated for Week ${week_no}`
  });

  await sendTemplate(client.phone, 'weekly_program', {
    name: client.name,
    templateParams: [client.name, `Week ${week_no}`],
    media: { url: pdfUrl, filename: `Week_${week_no}_Program.pdf` }
  });

  await supabase
    .from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ success: true, pdf_url: pdfUrl });
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 40);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`${client.name} — Week ${weekNo} Program`, 50, 80);

    doc.moveDown(4);
    doc.fill('#2C2C2C');

    doc.fontSize(18).text('WORKOUT PLAN', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fill('#333333');

    const workout = programData.workout_plan || {};
    for (const [day, exercises] of Object.entries(workout)) {
      doc.moveDown(0.5);
      doc.fontSize(13).fill('#B8965A').text(day.replace('_', ' ').toUpperCase());
      doc.fontSize(10).fill('#333333');

      if (Array.isArray(exercises)) {
        exercises.forEach(ex => {
          const line = typeof ex === 'string' ? ex : `${ex.name || ex.exercise} — ${ex.sets}x${ex.reps} (${ex.rest || '60s'} rest)`;
          doc.text(`  • ${line}`);
        });
      } else if (typeof exercises === 'object') {
        for (const [key, val] of Object.entries(exercises)) {
          doc.text(`  • ${key}: ${JSON.stringify(val)}`);
        }
      }
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, 20);

    doc.moveDown(3);
    doc.fill('#333333').fontSize(11);

    const nutrition = programData.nutrition_plan || {};
    if (nutrition.daily_calories) {
      doc.text(`Daily Calories: ${nutrition.daily_calories} kcal`);
    }
    if (nutrition.macros) {
      doc.text(`Macros: P ${nutrition.macros.protein}g | C ${nutrition.macros.carbs}g | F ${nutrition.macros.fat}g`);
    }
    doc.moveDown();

    const meals = nutrition.meals || nutrition.meal_plan || [];
    if (Array.isArray(meals)) {
      meals.forEach(meal => {
        doc.fontSize(12).fill('#B8965A').text(meal.name || meal.meal || 'Meal');
        doc.fontSize(10).fill('#333333');
        const items = meal.items || meal.foods || [];
        items.forEach(item => doc.text(`  • ${item}`));
        doc.moveDown(0.3);
      });
    }

    doc.moveDown(2);
    doc.fontSize(9).fill('#999999')
      .text('Generated by Fitness by Maddy | fitnessbymaddy.com', { align: 'center' });

    doc.end();
  });
}
