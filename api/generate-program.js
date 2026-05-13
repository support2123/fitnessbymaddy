const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'starvation', 'clenbuterol', 'dnp', 'dinitrophenol', 'ephedrine',
  'anavar', 'winstrol', 'tren', 'testosterone inject',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
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

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: intake } = await db
    .from('intake_forms')
    .select('data')
    .or(`lead_id.eq.${client.lead_id},client_id.eq.${client.id}`)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single();

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: lastProgram } = await db
    .from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(1)
    .single();

  try {
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, intake?.data, recentCheckins, lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    const hasSafetyIssue = SAFETY_FLAGS.some(flag =>
      content.toLowerCase().includes(flag)
    );

    if (hasSafetyIssue) {
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy({
        phone: client.phone,
        reason: 'Safety flag in generated program — needs manual review',
        messageBody: `Week ${week_no} program contained flagged content`,
        clientId: client.id
      });

      await db.from('programs').insert({
        client_id, week_no,
        workout_plan: { flagged: true },
        nutrition_plan: { flagged: true },
        notes: 'FLAGGED FOR REVIEW — safety concern detected'
      });

      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    const { workoutPlan, nutritionPlan } = parseProgram(content);

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: `Auto-generated for week ${week_no}`
    });

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [client.name || 'there', String(week_no), pdfUrl]
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    console.log(`Program generated: week ${week_no} for ${maskPhone(client.phone)}`);
    return res.status(200).json({ ok: true, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, intakeData, checkins, lastProgram, weekNo) {
  const parts = [
    'You are a certified fitness coach designing a weekly training and nutrition program.',
    'Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan".',
    '',
    '## Client Profile',
    `Name: ${client.name || 'Client'}`,
    `Program: ${client.program}`,
    `Week: ${weekNo} of 12`
  ];

  if (intakeData) {
    parts.push('', '## Intake Data', JSON.stringify(intakeData, null, 2));
  }

  if (checkins?.length) {
    parts.push('', '## Recent Check-ins');
    for (const c of checkins) {
      parts.push(`Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`);
    }
  }

  if (lastProgram) {
    parts.push('', '## Last Week Program Summary',
      JSON.stringify(lastProgram.workout_plan, null, 2));
  }

  parts.push(
    '',
    '## Rules',
    '- Design a 5-6 day split appropriate for the client',
    '- Include sets, reps, rest periods for each exercise',
    '- Nutrition: daily calories, protein/carbs/fat targets, 3 meal suggestions',
    '- Never prescribe below 1200 calories for women or 1500 for men',
    '- Never recommend banned substances or extreme protocols',
    '- Progressively overload from the previous week if data exists',
    '- Be specific and practical — not generic',
    '',
    'Return JSON only. No markdown, no explanation.'
  );

  return parts.join('\n');
}

function parseProgram(content) {
  try {
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const parsed = JSON.parse(cleaned);
    return {
      workoutPlan: parsed.workout_plan || parsed.workoutPlan || parsed,
      nutritionPlan: parsed.nutrition_plan || parsed.nutritionPlan || {}
    };
  } catch {
    return {
      workoutPlan: { raw: content },
      nutritionPlan: {}
    };
  }
}

function generatePDF(client, weekNo, workoutPlan, nutritionPlan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(3);

    doc.fontSize(18).fill('#2C2C2C')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    doc.fontSize(10).fill('#333333');
    renderJSON(doc, workoutPlan);

    doc.addPage();

    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(18).fill('#B8965A')
      .text('NUTRITION PLAN', 50, 30, { align: 'center' });

    doc.moveDown(3);
    doc.fontSize(10).fill('#333333');
    renderJSON(doc, nutritionPlan);

    doc.end();
  });
}

function renderJSON(doc, obj, indent) {
  indent = indent || 0;
  if (!obj || typeof obj !== 'object') {
    doc.text(String(obj), 50 + indent * 15);
    return;
  }

  const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
  for (const [key, value] of entries) {
    if (typeof value === 'object' && value !== null) {
      const label = Array.isArray(obj) ? '' : `${formatKey(key)}:`;
      if (label) {
        doc.fontSize(11).fill('#2C2C2C').text(label, 50 + indent * 15);
      }
      renderJSON(doc, value, indent + 1);
      doc.moveDown(0.3);
    } else {
      const label = Array.isArray(obj) ? `• ${value}` : `${formatKey(key)}: ${value}`;
      doc.fontSize(10).fill('#333333').text(label, 50 + indent * 15, undefined, {
        width: 495 - indent * 15
      });
    }
  }
}

function formatKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
