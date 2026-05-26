const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const RISKY_TERMS = [
  'extreme calorie', 'below 1000 cal', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'sarms', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'crash diet', 'water fast'
];

function hasSafetyFlag(text) {
  const lower = (text || '').toLowerCase();
  return RISKY_TERMS.some(term => lower.includes(term));
}

async function generateWithClaude(client, checkins) {
  const anthropic = new Anthropic();

  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prompt = `You are a certified fitness program architect for FitnessByMaddy coaching.

Client profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/limitations: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

Recent check-in data:
${checkinSummary || 'No previous check-ins (Week 1)'}

Generate a complete weekly program with:
1. workout_plan: 5-6 day split with exercises, sets, reps, rest times
2. nutrition_plan: daily calorie target, macro split, meal timing, sample meals
3. notes: 2-3 sentences of personal coaching notes

CRITICAL RULES:
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend any banned or controlled substances
- Never promise specific weight loss timelines
- Adjust based on compliance and energy scores from check-ins
- Be encouraging but evidence-based

Return valid JSON with keys: workout_plan, nutrition_plan, notes`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  return JSON.parse(jsonMatch[0]);
}

function buildPDF(client, weekNo, plan) {
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

    doc.fill('#2C2C2C');
    let y = 150;

    doc.fontSize(20).fill('#B8965A').text('WORKOUT PLAN', 50, y);
    y += 35;
    doc.fontSize(10).fill('#2C2C2C');

    const workout = plan.workout_plan;
    if (typeof workout === 'object' && workout !== null) {
      for (const [day, exercises] of Object.entries(workout)) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).fill('#2C2C2C').text(day.toUpperCase(), 50, y);
        y += 20;
        doc.fontSize(10).fill('#6B6B6B');
        if (Array.isArray(exercises)) {
          for (const ex of exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            const line = typeof ex === 'string' ? ex : `${ex.exercise || ex.name} — ${ex.sets || ''}x${ex.reps || ''} (${ex.rest || '60s'} rest)`;
            doc.text(`  ${line}`, 60, y);
            y += 16;
          }
        } else if (typeof exercises === 'string') {
          doc.text(`  ${exercises}`, 60, y);
          y += 16;
        }
        y += 10;
      }
    }

    doc.addPage();
    y = 50;
    doc.fontSize(20).fill('#B8965A').text('NUTRITION PLAN', 50, y);
    y += 35;
    doc.fontSize(10).fill('#2C2C2C');

    const nutrition = plan.nutrition_plan;
    if (typeof nutrition === 'object' && nutrition !== null) {
      for (const [key, value] of Object.entries(nutrition)) {
        if (y > 730) { doc.addPage(); y = 50; }
        doc.fontSize(12).fill('#2C2C2C').text(key.replace(/_/g, ' ').toUpperCase(), 50, y);
        y += 18;
        doc.fontSize(10).fill('#6B6B6B');
        if (Array.isArray(value)) {
          for (const item of value) {
            const line = typeof item === 'string' ? item : JSON.stringify(item);
            doc.text(`  ${line}`, 60, y);
            y += 16;
          }
        } else {
          doc.text(`  ${String(value)}`, 60, y);
          y += 16;
        }
        y += 8;
      }
    }

    if (plan.notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.fontSize(12).fill('#B8965A').text('COACH NOTES', 50, y);
      y += 20;
      doc.fontSize(10).fill('#2C2C2C').text(plan.notes, 50, y, { width: 500 });
    }

    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill('#2C2C2C');
    doc.fontSize(8).fill('#B8965A')
      .text('fitnessbymaddy.com | Personalised coaching by Maddy', 50, doc.page.height - 28, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['x-internal-key'];
  if (auth !== process.env.INTERNAL_API_KEY && auth !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const { data: client } = await db.from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: checkins } = await db.from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  let plan;
  try {
    plan = await generateWithClaude(client, checkins || []);
  } catch (err) {
    console.error('Claude API error:', err.message);
    await notifyMaddy(
      'Program generation failed',
      `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nError: ${err.message}`
    );
    return res.status(500).json({ error: 'AI generation failed' });
  }

  const fullText = JSON.stringify(plan);
  if (hasSafetyFlag(fullText)) {
    await notifyMaddy(
      'SAFETY FLAG — program halted for review',
      `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nFlagged content detected. Review before sending.`
    );
    await db.from('programs').insert({
      client_id, week_no,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: `FLAGGED FOR REVIEW: ${plan.notes || ''}`
    });
    return res.status(200).json({ ok: true, flagged: true });
  }

  const pdfBuffer = await buildPDF(client, week_no, plan);
  const pdfPath = `${client.id}/week_${week_no}.pdf`;

  const { error: uploadError } = await db.storage
    .from('clients')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (uploadError) {
    console.error('PDF upload error:', uploadError);
    return res.status(500).json({ error: 'PDF upload failed' });
  }

  const { data: urlData } = db.storage
    .from('clients')
    .getPublicUrl(pdfPath);

  const pdfUrl = urlData?.publicUrl || pdfPath;

  const { data: program } = await db.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: plan.workout_plan,
    nutrition_plan: plan.nutrition_plan,
    notes: plan.notes
  }).select().single();

  await sendTemplate(client.phone, 'weekly_program', {
    name: client.name || 'there',
    templateParams: [client.name || 'there', String(week_no)],
    media: { url: pdfUrl, filename: `Week_${week_no}_Program.pdf` }
  });

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
};
