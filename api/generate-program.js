const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { isHinglish, detectMarket } = require('./lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'crash diet', 'water fast',
];

function checkSafetyFlags(text) {
  const lower = (text || '').toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

async function generatePDF(workout, nutrition, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(28).fill('#D4AF7A').text('FITNESS BY MADDY', 50, 25, { align: 'center' });
    doc.fontSize(12).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 55, { align: 'center' });

    doc.moveDown(3);
    doc.fontSize(10).fill('#6B6B6B').text(`Prepared for: ${clientName || 'Client'}`, 50);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);
    doc.moveDown(2);

    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill('#E8E3DC');
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill('#2C2C2C').text(day.name || 'Day', 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  ${ex.name} — ${ex.sets || 3}x${ex.reps || 12} ${ex.notes || ''}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).fill('#6B6B6B').text(JSON.stringify(workout, null, 2).slice(0, 2000), 50);
    }

    if (doc.y > doc.page.height - 200) doc.addPage();

    doc.moveDown(2);
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill('#E8E3DC');
    doc.moveDown(0.5);

    if (nutrition && nutrition.meals) {
      doc.fontSize(11).fill('#2C2C2C').text(`Daily Calories: ${nutrition.calories || 'TBD'} kcal`, 50);
      doc.text(`Protein: ${nutrition.protein || 'TBD'}g | Carbs: ${nutrition.carbs || 'TBD'}g | Fats: ${nutrition.fats || 'TBD'}g`, 50);
      doc.moveDown(0.5);
      for (const meal of nutrition.meals) {
        doc.fontSize(12).fill('#2C2C2C').text(meal.name || 'Meal', 50);
        doc.fontSize(10).fill('#6B6B6B').text(`  ${meal.description || ''}`, 60);
        doc.moveDown(0.3);
      }
    } else {
      doc.fontSize(10).fill('#6B6B6B').text(JSON.stringify(nutrition, null, 2).slice(0, 2000), 50);
    }

    doc.moveDown(3);
    doc.rect(0, doc.y, doc.page.width, 40).fill('#2C2C2C');
    doc.fontSize(8).fill('#D4AF7A').text('fitnessbymaddy.com | @fitnessbymaddy_', 0, doc.y + 14, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a world-class fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, steroids, SARMs, or dangerous supplements
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Focus on progressive overload, balanced macros, and sustainability
- Always include rest days and deload guidance
- Be warm, motivating, and evidence-based

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout": {
    "days": [
      { "name": "Day 1 - Upper Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "RPE 7-8" }
      ]}
    ],
    "notes": "Focus on..."
  },
  "nutrition": {
    "calories": 2200,
    "protein": 160,
    "carbs": 250,
    "fats": 65,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "..." }
    ],
    "notes": "..."
  },
  "context_note": "One line summary for WhatsApp"
}`;

    const checkinContext = recentCheckins?.length
      ? recentCheckins.map(c =>
          `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
        ).join('\n')
      : 'No previous check-ins yet (Week 1).';

    const userPrompt = `Create Week ${week_no} program for:
Name: ${client.name || 'Client'}
Program: ${client.program}
Recent check-ins:
${checkinContext}

Design an optimal week of training and nutrition based on their progress and feedback.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const safetyCheck = checkSafetyFlags(JSON.stringify(programData));
    if (safetyCheck) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy({
        phone: client.phone,
        reason: `Safety flag in generated program: "${safetyCheck}"`,
        messageBody: `Week ${week_no} program for ${client.name} contained flagged content.`,
        clientId: client.id,
      });
      return res.status(200).json({ flagged: true, reason: safetyCheck });
    }

    const pdfBuffer = await generatePDF(
      programData.workout, programData.nutrition, client.name, week_no
    );

    const pdfPath = `${client.folder_url || `clients/${client.id}`}/week_${week_no}.pdf`;
    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: publicUrl } = db.storage.from('clients').getPublicUrl(pdfPath);

    const { data: program } = await db.from('programs').insert({
      client_id: client.id,
      week_no,
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.context_note || null,
    }).select().single();

    const market = detectMarket(client.phone);
    const contextNote = programData.context_note || `Week ${week_no} program ready!`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [client.name || 'there', contextNote],
      mediaUrl: publicUrl?.publicUrl,
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program?.id });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
