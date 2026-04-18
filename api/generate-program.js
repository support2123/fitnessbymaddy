const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone, detectMarket, isHinglishMarket } = require('../lib/utils');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*(10|15|20)\+?\s*kg.*week/i,
  /extreme\s*cut/i,
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*, leads!clients_lead_id_fkey(intake_data, market)')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: prevProgram } = await supabase
    .from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .eq('week_no', week_no - 1)
    .maybeSingle();

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const intakeData = client.leads?.intake_data || {};

  const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create weekly personalized workout and nutrition plans.

Rules:
- Be evidence-based and conservative with calorie recommendations (never below 1200 for women, 1500 for men)
- Never recommend banned substances, extreme protocols, or unrealistic timelines
- Adapt to the client's equipment access, injuries, and experience level
- Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan"
- workout_plan: array of 5-6 day objects with {day, focus, exercises: [{name, sets, reps, rest, notes}]}
- nutrition_plan: {calories, protein_g, carbs_g, fat_g, meals: [{name, foods, macros}], hydration, supplements}`;

  const userPrompt = `Generate Week ${week_no} program for this client:

Client Profile:
- Name: ${client.name}
- Program: ${client.program}
- Age: ${intakeData.age || 'unknown'}
- Gender: ${intakeData.gender || 'unknown'}
- Height: ${intakeData.height || 'unknown'}
- Weight: ${recentCheckins?.[0]?.weight || intakeData.weight || 'unknown'}
- Goal: ${intakeData.goal || 'general fitness'}
- Injuries: ${intakeData.injuries || 'none reported'}
- Medical: ${intakeData.medical_conditions || 'none'}
- Diet: ${intakeData.diet_preference || 'no preference'}
- Experience: ${intakeData.training_experience || 'intermediate'}
- Equipment: ${intakeData.equipment_access || 'full gym'}
- Schedule: ${intakeData.weekly_schedule || '5 days/week'}

${recentCheckins?.length > 0 ? `Recent Check-in Data:
${recentCheckins.map(c => `- Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')}` : 'No check-in data yet (first week).'}

${prevProgram ? `Previous Week Plan Summary:
${JSON.stringify(prevProgram.workout_plan || {}).slice(0, 500)}` : 'No previous plan (first week).'}

Generate the next week's workout and nutrition plan as JSON.`;

  let generated;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');
    generated = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  const fullText = JSON.stringify(generated);
  const isRisky = RISKY_PATTERNS.some(p => p.test(fullText));
  if (isRisky) {
    await sendTemplate('917082478374', 'escalation_alert', [
      maskPhone(client.phone),
      `Week ${week_no} program flagged for risky content. Review before sending.`,
    ]);
    await supabase.from('programs').upsert({
      client_id,
      week_no,
      workout_plan: generated.workout_plan,
      nutrition_plan: generated.nutrition_plan,
      notes: 'FLAGGED - Awaiting Maddy review',
    }, { onConflict: 'client_id,week_no' });

    return res.status(200).json({ success: true, flagged: true });
  }

  const pdfBuffer = await generatePDF(client, week_no, generated);

  const pdfPath = `${client.id}/week_${week_no}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('clients')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    console.error('PDF upload error:', uploadError);
  }

  const { data: urlData } = supabase.storage
    .from('clients')
    .getPublicUrl(pdfPath);

  const pdfUrl = urlData?.publicUrl || pdfPath;

  await supabase.from('programs').upsert({
    client_id,
    week_no,
    workout_plan: generated.workout_plan,
    nutrition_plan: generated.nutrition_plan,
    pdf_url: pdfUrl,
    notes: null,
  }, { onConflict: 'client_id,week_no' });

  const market = detectMarket(client.phone);
  const templateName = isHinglishMarket(market) ? 'weekly_program_hi' : 'weekly_program';
  await sendTemplate(client.phone, templateName, [
    client.name || 'Champion',
    `Week ${week_no}`,
    pdfUrl,
  ]);

  await supabase
    .from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ success: true, pdf_url: pdfUrl });
};

function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 40, 40, { characterSpacing: 4 });

    doc.fill('#FFFFFF').fontSize(28).font('Helvetica-Bold')
      .text(`WEEK ${weekNo} PROGRAM`, 40, 70);

    doc.fill('#B8965A').fontSize(12).font('Helvetica')
      .text(`${client.name || 'Client'} | ${client.program || '12wk'}`, 40, 108);

    doc.moveTo(40, 135).lineTo(555, 135).stroke('#B8965A');

    let y = 155;

    if (plan.workout_plan && Array.isArray(plan.workout_plan)) {
      doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 40, y);
      y += 25;

      for (const day of plan.workout_plan) {
        if (y > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 40; }

        doc.fill('#FFFFFF').fontSize(11).font('Helvetica-Bold')
          .text(`${day.day || ''} - ${day.focus || ''}`, 40, y);
        y += 18;

        if (day.exercises && Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 40; }
            const line = `${ex.name}: ${ex.sets}x${ex.reps} | Rest: ${ex.rest || '60s'}`;
            doc.fill('#CCCCCC').fontSize(9).font('Helvetica').text(line, 55, y);
            y += 14;
            if (ex.notes) {
              doc.fill('#888888').fontSize(8).text(`  ${ex.notes}`, 55, y);
              y += 12;
            }
          }
        }
        y += 8;
      }
    }

    if (plan.nutrition_plan) {
      if (y > 600) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 40; }

      y += 10;
      doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 40, y);
      y += 25;

      const np = plan.nutrition_plan;
      const macroLine = `Calories: ${np.calories || '—'} | Protein: ${np.protein_g || '—'}g | Carbs: ${np.carbs_g || '—'}g | Fat: ${np.fat_g || '—'}g`;
      doc.fill('#FFFFFF').fontSize(10).font('Helvetica').text(macroLine, 40, y);
      y += 20;

      if (np.meals && Array.isArray(np.meals)) {
        for (const meal of np.meals) {
          if (y > 730) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 40; }
          doc.fill('#FFFFFF').fontSize(10).font('Helvetica-Bold').text(meal.name || 'Meal', 40, y);
          y += 15;
          const foods = Array.isArray(meal.foods) ? meal.foods.join(', ') : (meal.foods || '');
          doc.fill('#CCCCCC').fontSize(9).font('Helvetica').text(foods, 55, y, { width: 480 });
          y += doc.heightOfString(foods, { width: 480, fontSize: 9 }) + 8;
        }
      }

      if (np.hydration) {
        y += 5;
        doc.fill('#888888').fontSize(9).text(`Hydration: ${np.hydration}`, 40, y);
        y += 14;
      }
      if (np.supplements) {
        doc.fill('#888888').fontSize(9).text(`Supplements: ${np.supplements}`, 40, y);
      }
    }

    const lastPage = doc.bufferedPageRange();
    doc.fill('#B8965A').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | Confidential - For client use only', 40, 780, { align: 'center', width: 515 });

    doc.end();
  });
}
