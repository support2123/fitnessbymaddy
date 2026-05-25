const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const DANGEROUS_PATTERNS = [
  /below\s*800\s*cal/i,
  /extreme\s*calor/i,
  /starvation/i,
  /dnp/i,
  /clenbuterol/i,
  /anabolic\s*steroid/i,
  /ephedra/i,
  /crash\s*diet/i,
  /lose\s*\d+\s*kg\s*in\s*1\s*week/i,
];

function hasDangerousContent(text) {
  return DANGEROUS_PATTERNS.some((p) => p.test(text));
}

async function generatePDF(workout, nutrition, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica')
      .fillColor('#B8965A')
      .text(`Week ${weekNo} Program — ${clientName || 'Client'}`, { align: 'center' });
    doc.fillColor('#2C2C2C');

    doc.moveDown(2);
    doc.fontSize(18).font('Helvetica-Bold').text('WORKOUT PLAN');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');

    if (typeof workout === 'object' && workout !== null) {
      for (const [day, exercises] of Object.entries(workout)) {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(13).text(day.toUpperCase());
        doc.font('Helvetica').fontSize(11);
        if (Array.isArray(exercises)) {
          exercises.forEach((ex) => {
            doc.text(`  • ${ex.name || ex} — ${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`.trim());
          });
        } else {
          doc.text(`  ${exercises}`);
        }
      }
    } else {
      doc.text(String(workout));
    }

    doc.addPage();
    doc.fontSize(18).font('Helvetica-Bold').text('NUTRITION PLAN');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');

    if (typeof nutrition === 'object' && nutrition !== null) {
      for (const [key, val] of Object.entries(nutrition)) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(12).text(key.toUpperCase());
        doc.font('Helvetica').fontSize(11);
        if (Array.isArray(val)) {
          val.forEach((item) => doc.text(`  • ${typeof item === 'string' ? item : JSON.stringify(item)}`));
        } else if (typeof val === 'object') {
          for (const [k, v] of Object.entries(val)) {
            doc.text(`  ${k}: ${v}`);
          }
        } else {
          doc.text(`  ${val}`);
        }
      }
    } else {
      doc.text(String(nutrition));
    }

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#6B6B6B')
      .text('This program is designed by Fitness by Maddy. Always consult your physician before starting any new exercise program.', { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getClient();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*, leads(*)')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: intakeData } = await db
    .from('clients')
    .select('intake_data')
    .eq('id', client_id)
    .single();

  const claude = new Anthropic();

  const systemPrompt = `You are a certified personal trainer and nutrition coach working for Fitness by Maddy.
Generate a weekly training and nutrition program based on the client's data.
Output valid JSON with two keys: "workout_plan" and "nutrition_plan".

workout_plan should be an object with day names as keys and arrays of exercises as values.
Each exercise: { "name": string, "sets": number, "reps": string, "notes": string }

nutrition_plan should include: "daily_calories", "protein_g", "carbs_g", "fat_g", "meals" (array of meal objects with "name" and "foods" array), and "notes".

RULES:
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances, steroids, or extreme protocols
- Adapt to injuries and conditions listed in profile
- Be specific with exercise names, rep ranges, and rest periods
- Include progressive overload from previous weeks when check-in data available`;

  const userPrompt = `Client: ${client.name || 'Unknown'}
Program: ${client.program}
Week: ${week_no}
Intake data: ${JSON.stringify(intakeData?.intake_data || {})}
Recent check-ins: ${JSON.stringify(recentCheckins || [])}

Generate Week ${week_no} program.`;

  let aiResponse;
  try {
    const msg = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    aiResponse = msg.content[0].text;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(502).json({ error: 'AI generation failed' });
  }

  if (hasDangerousContent(aiResponse)) {
    const { escalateToMaddy } = require('../lib/escalation');
    await escalateToMaddy(
      'Dangerous content in generated program',
      client.phone,
      `Week ${week_no} program flagged for review`
    );
    return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
  }

  let parsed;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse);
  } catch {
    console.error('Failed to parse AI response as JSON');
    return res.status(502).json({ error: 'AI response not valid JSON' });
  }

  const workout = parsed.workout_plan || {};
  const nutrition = parsed.nutrition_plan || {};

  const pdfBuffer = await generatePDF(workout, nutrition, client.name, week_no);

  const pdfPath = `${client_id}/week_${week_no}.pdf`;
  const { error: uploadError } = await db.storage
    .from('clients')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    console.error('PDF upload error:', uploadError.message);
  }

  const { data: publicUrl } = db.storage.from('clients').getPublicUrl(pdfPath);

  const { error: insertError } = await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: publicUrl?.publicUrl || null,
    workout_plan: workout,
    nutrition_plan: nutrition,
    notes: `Auto-generated Week ${week_no}`,
  });

  if (insertError) {
    console.error('Program insert error:', insertError.message);
  }

  const templateName = 'weekly_program';
  await sendTemplate(client.phone, templateName, [
    client.name || 'there',
    String(week_no),
    publicUrl?.publicUrl || 'Check your client portal',
  ]);
  await logMessage(client.phone, 'out', `Week ${week_no} program sent`, templateName);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('client_id', client_id).eq('week_no', week_no);

  return res.status(200).json({ ok: true, pdf_url: publicUrl?.publicUrl });
};
