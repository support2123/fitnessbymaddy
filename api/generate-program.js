const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendMediaMessage } = require('./_lib/whatsapp');
const { isHinglish, detectMarket } = require('./_lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function buildPrompt(client, checkins, weekNo) {
  const latest = checkins[0] || {};
  const previous = checkins[1] || {};

  return `You are a NASM-certified program architect for FitnessByMaddy, an elite online coaching brand.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${weekNo}
- Current weight: ${latest.weight || 'N/A'} kg
- Previous weight: ${previous.weight || 'N/A'} kg
- Waist: ${latest.waist || 'N/A'} cm
- Compliance score: ${latest.compliance_score || 'N/A'}/10
- Energy level: ${latest.energy || 'N/A'}/10
- Issues reported: ${latest.issues || 'None'}
- Focus area: ${latest.next_week_focus || 'General progression'}

GENERATE a complete Week ${weekNo} program with:

1. WORKOUT PLAN (JSON):
   - 5-6 training days with rest days
   - Each day: exercise name, sets, reps, rest period, tempo, RPE
   - Progressive overload from previous week
   - Adjust volume based on compliance and energy scores

2. NUTRITION PLAN (JSON):
   - Daily calorie target
   - Macros (protein, carbs, fat in grams)
   - Meal timing suggestions (4-5 meals)
   - 2 sample meal plans
   - Hydration target

3. COACHING NOTES:
   - 2-3 sentences of personalized encouragement
   - 1 specific tip based on their check-in data
   - Focus area for the week

Respond in valid JSON with keys: workout_plan, nutrition_plan, notes
Be evidence-based. Never recommend extreme caloric deficits (<1200 cal for women), banned substances, or unrealistic timelines.`;
}

async function generatePDF(program, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 100).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 40, 30);
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program — ${client.name}`, 40, 65);

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    // Workout section
    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 40, 120);
    doc.moveDown(0.5);

    const workout = program.workout_plan;
    if (workout && typeof workout === 'object') {
      const days = workout.days || workout.schedule || Object.entries(workout);
      const entries = Array.isArray(days) ? days : [workout];

      let yPos = doc.y;
      for (const day of entries) {
        if (yPos > 700) {
          doc.addPage();
          yPos = 40;
        }
        const dayName = day.day || day.name || (Array.isArray(day) ? day[0] : 'Training Day');
        doc.fontSize(12).fill('#2C2C2C').text(String(dayName).toUpperCase(), 40, yPos);
        yPos += 18;

        const exercises = day.exercises || day.movements || day[1]?.exercises || [];
        if (Array.isArray(exercises)) {
          for (const ex of exercises) {
            const name = ex.name || ex.exercise || String(ex);
            const detail = ex.sets ? `${ex.sets}x${ex.reps} @ RPE ${ex.rpe || '7-8'}` : '';
            doc.fontSize(10).fill('#6B6B6B').text(`  • ${name} ${detail}`, 50, yPos);
            yPos += 15;
          }
        }
        yPos += 10;
      }
    }

    // Nutrition section
    doc.addPage();
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 40, 40);
    doc.moveDown(0.5);

    const nutrition = program.nutrition_plan;
    if (nutrition && typeof nutrition === 'object') {
      doc.fontSize(11).fill('#2C2C2C');
      if (nutrition.calories) doc.text(`Daily Calories: ${nutrition.calories} kcal`, 40);
      if (nutrition.protein) doc.text(`Protein: ${nutrition.protein}g`, 40);
      if (nutrition.carbs) doc.text(`Carbs: ${nutrition.carbs}g`, 40);
      if (nutrition.fat) doc.text(`Fat: ${nutrition.fat}g`, 40);
      if (nutrition.hydration) doc.text(`Hydration: ${nutrition.hydration}`, 40);

      doc.moveDown(1);
      if (nutrition.meals && Array.isArray(nutrition.meals)) {
        doc.fontSize(13).fill('#B8965A').text('SAMPLE MEALS');
        doc.moveDown(0.5);
        for (const meal of nutrition.meals) {
          const mealName = meal.name || meal.time || 'Meal';
          doc.fontSize(10).fill('#2C2C2C').text(`${mealName}: ${meal.description || meal.items || ''}`, 40);
          doc.moveDown(0.3);
        }
      }
    }

    // Notes section
    if (program.notes) {
      doc.moveDown(1);
      doc.fontSize(13).fill('#B8965A').text('COACH NOTES');
      doc.moveDown(0.5);
      doc.fontSize(10).fill('#6B6B6B').text(String(program.notes), 40, doc.y, { width: 500 });
    }

    // Footer
    doc.fontSize(8).fill('#C8B89A').text('fitnessbymaddy.com | @fitnessbymaddy', 40, 780);

    doc.end();
  });
}

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
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const prompt = await buildPrompt(client, checkins || [], week_no);

    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    if (hasSafetyIssue(responseText)) {
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy(
        'Safety flag in generated program',
        client.phone,
        `Week ${week_no} program flagged for review`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      return res.status(500).json({ error: 'Failed to parse Claude response' });
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    const { data: pdfUrl } = supabase.storage.from('clients').getPublicUrl(pdfPath);

    const { data: programRecord } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl.publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    }).select().single();

    const market = detectMarket(client.phone);
    const caption = isHinglish(market)
      ? `💪 Week ${week_no} program ready hai, ${client.name}! Check karo aur shuru ho jao 🔥`
      : `💪 Week ${week_no} program is ready, ${client.name}! Review it and let's crush this week 🔥`;

    await sendMediaMessage(client.phone, pdfUrl.publicUrl, caption);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', programRecord.id);

    return res.status(200).json({ ok: true, program_id: programRecord.id, pdf_url: pdfUrl.publicUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
