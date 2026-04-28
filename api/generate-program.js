const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const prompt = buildPrompt(client, recentCheckins, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    let programData;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      programData = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch {
      programData = { raw: responseText, workout_plan: {}, nutrition_plan: {} };
    }

    if (containsRiskyContent(programData)) {
      const { sendTemplate: notify } = require('../lib/whatsapp');
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy('Risky program content flagged', {
        phone: client.phone,
        message: `Week ${week_no} program for ${client.name} flagged for review`
      });
      return res.status(200).json({ ok: true, flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan || programData,
        nutrition_plan: programData.nutrition_plan || {},
        notes: programData.notes || null
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      pdfUrl
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  const checkinSummary = checkins && checkins.length > 0
    ? checkins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')
    : 'No previous check-ins available.';

  return `You are a certified fitness coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12

RECENT CHECK-INS:
${checkinSummary}

Create a complete weekly program in JSON format with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meal_timing": ["..."],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "One-liner coaching note for the week"
}

RULES:
- Be progressive based on check-in data
- Never prescribe extreme calorie cuts (below 1200 for women, 1500 for men)
- Never recommend banned substances
- Keep timelines realistic
- Adjust based on compliance and energy scores
- If issues mention pain, recommend deload or modification

Return ONLY the JSON wrapped in \`\`\`json code fences.`;
}

function containsRiskyContent(data) {
  const text = JSON.stringify(data).toLowerCase();
  const riskyTerms = [
    'steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedrine',
    'hgh', 'testosterone inject', 'anavar', 'trenbolone'
  ];
  if (riskyTerms.some(t => text.includes(t))) return true;

  const cal = data?.nutrition_plan?.daily_calories;
  if (cal && cal < 1200) return true;

  return false;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#FFFFFF').fontSize(14).text(`Week ${weekNo} Program`, 50, 75, { align: 'center' });
    doc.fill('#D4AF7A').fontSize(10).text(client.name || 'Client', 50, 95, { align: 'center' });

    doc.fill('#2C2C2C');
    let y = 140;

    const workout = programData.workout_plan || programData;
    if (workout.days) {
      doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      if (y > 600) { doc.addPage(); y = 50; }
      y += 10;
      doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, y);
      y += 30;
      doc.fontSize(11).fill('#2C2C2C');
      if (nutrition.daily_calories) { doc.text(`Daily Calories: ${nutrition.daily_calories} kcal`, 60, y); y += 18; }
      if (nutrition.protein_g) { doc.text(`Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fat: ${nutrition.fat_g}g`, 60, y); y += 18; }
      if (nutrition.hydration) { doc.text(`Hydration: ${nutrition.hydration}`, 60, y); y += 18; }
      if (nutrition.meal_timing) {
        doc.text('Meal Timing:', 60, y); y += 16;
        for (const meal of nutrition.meal_timing) {
          doc.fontSize(10).fill('#6B6B6B').text(`  - ${meal}`, 70, y); y += 14;
        }
      }
    }

    if (programData.notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.fontSize(12).fill('#B8965A').text('COACH NOTES', 50, y);
      y += 20;
      doc.fontSize(10).fill('#6B6B6B').text(programData.notes, 60, y, { width: 480 });
    }

    doc.end();
  });
}
