const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendMedia } = require('../lib/whatsapp');
const { PROGRAM_DETAILS, maskPhone } = require('../lib/utils');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();
    const prompt = buildProgramPrompt(client, recentCheckins || [], week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      console.error('[PARSE ERROR] Could not parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (fullText.includes(flag)) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy(
          client.phone,
          `Safety flag in generated program: "${flag}"`,
          `Week ${week_no} program for ${client.name} contains risky content. Halted auto-send.`
        );
        await db.from('programs').insert({
          client_id, week_no,
          workout_plan: parsed.workout_plan || parsed.workout || {},
          nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
          notes: `HALTED: Safety flag "${flag}" detected`,
        });
        return res.status(200).json({ ok: false, reason: 'safety_flag', flag });
      }
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `${client.folder_url}/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('[UPLOAD ERROR]', uploadError.message);
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData?.publicUrl || '';

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || parsed.workout || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.coach_note || '',
    }).select('id').single();

    await sendMedia(
      client.phone,
      pdfUrl,
      `Week ${week_no} program ready! ${parsed.coach_note || 'Let\'s crush it this week.'}`
    );

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    console.log(`[PROGRAM] Generated week ${week_no} for ${maskPhone(client.phone)}`);
    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('[GENERATE ERROR]', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildProgramPrompt(client, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are an expert fitness coach creating a weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${PROGRAM_DETAILS[client.program]?.name || client.program}
- Age: ${client.age || 'Not specified'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}
- Week Number: ${weekNo} of ${PROGRAM_DETAILS[client.program]?.weeks || 12}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

Generate a complete Week ${weekNo} program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min incline walk"
      }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1 details", "Option 2 details"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4 liters water daily"
  },
  "coach_note": "One-liner motivation or focus for this week"
}

RULES:
- Be realistic and evidence-based
- Never recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances or unproven supplements
- Adjust based on check-in data (reduce volume if energy is low, modify if injuries reported)
- Keep it practical for someone training ${client.schedule || '4-5 days/week'}`;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fill('#FFFFFF').fontSize(14).text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'left' });
    doc.fill('#D4AF7A').fontSize(10).text(
      `${client.name || 'Client'} | ${PROGRAM_DETAILS[client.program]?.name || client.program}`,
      50, 95, { align: 'left' }
    );

    doc.moveDown(3);

    const workout = programData.workout_plan || programData.workout || {};
    const days = workout.days || [];

    doc.fill('#2C2C2C').fontSize(18).text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.strokeColor('#B8965A').lineWidth(2).moveTo(50, doc.y).lineTo(200, doc.y).stroke();
    doc.moveDown(1);

    for (const day of days) {
      if (doc.y > 700) doc.addPage();

      doc.fill('#B8965A').fontSize(13).text(`${day.day} - ${day.focus || ''}`, 50);
      doc.moveDown(0.3);

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        doc.fill('#2C2C2C').fontSize(10)
          .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60);
      }

      if (day.cardio) {
        doc.fill('#6B6B6B').fontSize(9).text(`  Cardio: ${day.cardio}`, 60);
      }
      doc.moveDown(0.8);
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(18).text('NUTRITION PLAN', 50, 20);

    doc.moveDown(2);
    const nutrition = programData.nutrition_plan || programData.nutrition || {};

    doc.fill('#2C2C2C').fontSize(12).text('DAILY TARGETS', 50);
    doc.moveDown(0.3);
    doc.fontSize(10)
      .text(`Calories: ${nutrition.calories || 'TBD'} kcal`, 60)
      .text(`Protein: ${nutrition.protein_g || 'TBD'}g  |  Carbs: ${nutrition.carbs_g || 'TBD'}g  |  Fat: ${nutrition.fat_g || 'TBD'}g`, 60);
    doc.moveDown(1);

    const meals = nutrition.meals || [];
    for (const meal of meals) {
      doc.fill('#B8965A').fontSize(11).text(meal.meal || '', 50);
      const options = meal.options || [];
      for (const opt of options) {
        doc.fill('#2C2C2C').fontSize(9).text(`  - ${opt}`, 60);
      }
      doc.moveDown(0.5);
    }

    if (nutrition.supplements) {
      doc.moveDown(0.5);
      doc.fill('#2C2C2C').fontSize(11).text('SUPPLEMENTS', 50);
      for (const sup of nutrition.supplements) {
        doc.fontSize(9).text(`  - ${sup}`, 60);
      }
    }

    if (programData.coach_note) {
      doc.moveDown(2);
      doc.rect(40, doc.y, doc.page.width - 80, 50).fill('#FAF8F4');
      doc.fill('#B8965A').fontSize(10).text(`Coach's Note: ${programData.coach_note}`, 55, doc.y - 40);
    }

    const bottomY = doc.page.height - 40;
    doc.fill('#C8B89A').fontSize(8).text(
      'fitnessbymaddy.com | This program is personalised - do not share.',
      50, bottomY, { align: 'center', width: doc.page.width - 100 }
    );

    doc.end();
  });
}
