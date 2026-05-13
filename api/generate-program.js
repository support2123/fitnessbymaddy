const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'very low calorie diet', 'vlcd', 'psmf'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
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

    // Get last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get previous program if exists
    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    // Build Claude prompt
    const programData = await generateWithClaude(client, checkins || [], prevProgram, week_no);

    // Safety check
    const jsonStr = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => jsonStr.includes(f));
    if (flagged) {
      await escalateToMaddy({
        reason: 'Program flagged for safety review',
        phone: client.phone,
        context: `Week ${week_no} program contains potentially risky content. Halted for manual review.`
      });
      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(client, programData, week_no);

    // Upload to Supabase Storage
    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Save to programs table (audit trail)
    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    });

    // Send via WhatsApp
    const contextNote = programData.notes || `Your Week ${week_no} program is ready!`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: `${client.name ? `Hey ${client.name}! ` : ''}${contextNote}\n\nYour Week ${week_no} plan has been sent. Check your email for the PDF, or download it here.`,
      params: [client.name || 'there', String(week_no)]
    });

    // Update whatsapp_sent_at
    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

async function generateWithClaude(client, checkins, prevProgram, weekNo) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues=${c.issues || 'none'}`
  ).join('\n');

  const prevSummary = prevProgram
    ? `Previous plan highlights: ${JSON.stringify(prevProgram.workout_plan || {}).slice(0, 500)}`
    : 'No previous plan (first week).';

  const systemPrompt = `You are a NASM-certified fitness program architect working for Fitness by Maddy. Design weekly training and nutrition plans that are:
- Evidence-based and safe
- Progressive (building on previous weeks)
- Realistic and sustainable
- Appropriate for the client's level and goals

NEVER include: extreme calorie restrictions below 1200kcal/day, banned substances, unrealistic timelines, medical advice.
Always include: warm-up, cool-down, rest days, adequate protein, hydration notes.

Output strictly as JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "...",
    "warmup": "...",
    "cooldown": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 65,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "hydration": "...",
    "supplements": "..."
  },
  "notes": "One-liner context note for the client about this week's focus"
}`;

  const userPrompt = `Generate Week ${weekNo} program for this client:

Name: ${client.name || 'Client'}
Program: ${client.program}
Started: ${client.program_started_at}

Recent check-ins:
${checkinSummary || 'No check-ins yet (first week).'}

${prevSummary}

Design an appropriate Week ${weekNo} plan. Progress from previous week if data available.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse Claude response as JSON');

  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 100).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 65);

    doc.moveDown(3);

    // Workout Plan
    doc.fontSize(18).fillColor('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    const wp = programData.workout_plan;
    if (wp?.warmup) {
      doc.fontSize(10).fillColor('#6B6B6B').text(`Warm-up: ${wp.warmup}`, 50);
      doc.moveDown(0.3);
    }

    if (wp?.days) {
      for (const day of wp.days) {
        doc.moveDown(0.5);
        doc.fontSize(13).fillColor('#B8965A').text(day.day.toUpperCase(), 50);
        doc.fontSize(10).fillColor('#2C2C2C').text(`Focus: ${day.focus}`, 60);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(9).fillColor('#6B6B6B')
              .text(`  ${ex.name} — ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ` | ${ex.notes}` : ''}`, 70);
          }
        }

        if (doc.y > 700) { doc.addPage(); }
      }
    }

    if (wp?.cooldown) {
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#6B6B6B').text(`Cool-down: ${wp.cooldown}`, 50);
    }

    // Nutrition Plan
    doc.addPage();
    doc.rect(0, 0, 595, 60).fill('#2C2C2C');
    doc.fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN', 50, 20);
    doc.moveDown(3);

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(12).fillColor('#2C2C2C')
        .text(`Daily Target: ${np.daily_calories} kcal`, 50);
      doc.fontSize(10).fillColor('#6B6B6B')
        .text(`Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fats: ${np.fats_g}g`, 50);
      doc.moveDown();

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).fillColor('#B8965A').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fillColor('#6B6B6B').text(`  • ${opt}`, 60);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#2C2C2C').text(`Hydration: ${np.hydration}`, 50);
      }
      if (np.supplements) {
        doc.fontSize(10).text(`Supplements: ${np.supplements}`, 50);
      }
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#C8B89A')
      .text('Fitness by Maddy | fitnessbymaddy.com | This plan is personalised — do not share.', 50, doc.y, { align: 'center' });

    doc.end();
  });
}
