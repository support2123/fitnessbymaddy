const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { logMessage } = require('./lib/rate-limit');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarms/i,
  /lose\s*\d{2,}\s*kg.*week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('intake_data')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a program architect for FitnessByMaddy, an elite online coaching brand.
Generate a personalized weekly workout + nutrition plan in JSON format.
Rules:
- Never prescribe under 1400 calories for women or 1600 for men
- Never recommend banned substances or extreme protocols
- Respect injuries and medical conditions
- Be progressive: each week should build on the last
- Output valid JSON with keys: workout_plan (array of day objects), nutrition_plan (object with macros, meals, notes)`;

    const userPrompt = `Client: ${client.name}
Program: ${client.program} | Week: ${week_no}/12
${intake ? `Profile: Age ${intake.age}, ${intake.gender}, ${intake.height}cm, ${intake.weight}kg
Goal: ${intake.goal}
Injuries: ${intake.injuries || 'None'}
Medical: ${intake.medical_conditions || 'None'}
Diet: ${intake.diet_preference}
Experience: ${intake.workout_experience}
Available days: ${intake.available_days}
Equipment: ${intake.equipment || 'Full gym'}` : 'No intake data available'}

${checkins && checkins.length > 0 ? `Recent check-ins:
${checkins.map(c => `Week ${c.week_no}: ${c.weight}kg, compliance ${c.compliance_score}/10, energy ${c.energy}/10, issues: ${c.issues || 'none'}`).join('\n')}` : 'First week — no prior data.'}

Generate the Week ${week_no} program as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let programData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const jsonStr = JSON.stringify(programData);
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(jsonStr)) {
        const { escalateToMaddy } = require('./lib/escalation');
        await escalateToMaddy('unsafe_program_content', {
          phone: client.phone,
          message: `Week ${week_no} program flagged for review: ${pattern.toString()}`
        });
        return res.status(200).json({ flagged: true, reason: pattern.toString() });
      }
    }

    const pdfBuffer = generatePDF(programData, client, week_no);
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: { publicUrl } } = db.storage.from('programs').getPublicUrl(pdfPath);

    const { error } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl,
      whatsapp_sent_at: null,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || null
    });

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name,
      `${week_no}`,
      publicUrl
    ]);
    await logMessage(client.phone, 'out', `[Week ${week_no} program sent]`, 'weekly_program');

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(programData, client, weekNo) {
  const PDFDocument = require('pdfkit');
  const chunks = [];

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.on('data', chunk => chunks.push(chunk));

  doc.rect(0, 0, 595, 842).fill('#1a1a1a');

  doc.font('Helvetica-Bold').fontSize(28).fillColor('#D4AF7A')
    .text('FITNESS BY MADDY', 50, 50);

  doc.fontSize(14).fillColor('#ffffff')
    .text(`${client.name} — Week ${weekNo}`, 50, 90);

  doc.moveDown(2);

  if (programData.workout_plan) {
    doc.fontSize(18).fillColor('#D4AF7A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    for (const day of programData.workout_plan) {
      doc.fontSize(12).fillColor('#ffffff')
        .text(`${day.day || day.name || 'Day'}`, 50);
      if (day.exercises) {
        for (const ex of day.exercises) {
          doc.fontSize(10).fillColor('#cccccc')
            .text(`  • ${ex.name || ex} — ${ex.sets || ''}x${ex.reps || ''} ${ex.rest || ''}`, 60);
        }
      }
      doc.moveDown(0.3);
    }
  }

  if (programData.nutrition_plan) {
    doc.addPage();
    doc.rect(0, 0, 595, 842).fill('#1a1a1a');
    doc.fontSize(18).fillColor('#D4AF7A').text('NUTRITION PLAN', 50, 50);
    doc.moveDown(0.5);

    const np = programData.nutrition_plan;
    if (np.macros) {
      doc.fontSize(12).fillColor('#ffffff')
        .text(`Calories: ${np.macros.calories || 'TBD'} | Protein: ${np.macros.protein || 'TBD'}g | Carbs: ${np.macros.carbs || 'TBD'}g | Fat: ${np.macros.fat || 'TBD'}g`, 50);
    }
    doc.moveDown(0.5);

    if (np.meals) {
      for (const meal of np.meals) {
        doc.fontSize(11).fillColor('#D4AF7A').text(meal.name || meal.time || 'Meal', 50);
        doc.fontSize(10).fillColor('#cccccc').text(`  ${meal.description || meal.foods || ''}`, 60);
        doc.moveDown(0.3);
      }
    }
  }

  doc.end();
  return Buffer.concat(chunks);
}
