const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { handleOptions, maskPhone } = require('../lib/utils');

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'under 1000',
  'under 800', 'starvation', 'clenbuterol', 'dnp',
  'ephedrine', 'steroids', 'anabolic', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const internalKey = req.headers['x-internal-key'];
  if (internalKey !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(200).json({ ok: true, message: 'Program already exists', id: existingProgram.id });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const prompt = buildPrompt(client, recentCheckins || [], week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const aiText = response.content[0].text;

    if (hasSafetyIssue(aiText)) {
      const { notifyMaddy } = require('../lib/escalation');
      await notifyMaddy(
        client.phone,
        `Safety flag in generated program W${week_no}`,
        'AI output contained flagged content. Review required.'
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = aiText.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : aiText);
    } catch {
      console.error('Failed to parse AI response');
      return res.status(500).json({ error: 'AI response parse error' });
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const pdfPath = `${client.folder_url || `clients/${client_id}`}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: urlData.publicUrl,
        workout_plan: parsed.workout_plan || parsed.workout,
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition,
        notes: parsed.notes || parsed.coach_notes || '',
      })
      .select()
      .single();

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.notes || 'Your new program is ready!',
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} W${week_no}`);
    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: 12-Week Custom Training
- Age: ${client.age || 'unknown'}
- Goal: ${client.goal || 'general fitness'}
- Injuries/limitations: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'no preference'}
- Schedule: ${client.schedule || 'flexible'}
- Program week: ${weekNo} of 12

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

GENERATE Week ${weekNo} program. Return ONLY valid JSON in this exact structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS", "duration": "25 min" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1 description", "Option 2 description"] }
    ],
    "supplements": ["Whey protein post-workout", "Creatine 5g daily"]
  },
  "notes": "One-liner context note for WhatsApp delivery"
}
\`\`\`

RULES:
- Be specific with exercise names, sets, reps, and rest periods
- Adjust difficulty based on check-in data (compliance, energy, issues)
- Never prescribe extreme calorie deficits (minimum 1200 for women, 1500 for men)
- Never recommend banned substances or unrealistic timelines
- Account for reported injuries and limitations
- If this is Week 1, start moderate and build progressive overload`;
}

function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    // Header
    doc.rect(0, 0, doc.page.width, 100).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').text('FITNESS BY MADDY', 50, 30, { align: 'left' });
    doc.fontSize(12).fill(gold).text(`WEEK ${weekNo} PROGRAM`, 50, 65, { align: 'left' });
    doc.fontSize(10).fill('#999999').text(client.name || 'Client', 400, 40, { align: 'right' });
    doc.fontSize(9).fill('#999999').text(new Date().toLocaleDateString('en-GB'), 400, 56, { align: 'right' });

    doc.moveDown(3);
    let y = 130;

    // Workout Plan
    doc.fontSize(18).fill(gold).text('WORKOUT PLAN', 50, y);
    y += 30;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(gold).lineWidth(1).stroke();
    y += 15;

    const workout = program.workout_plan || program.workout || {};
    const days = workout.days || [];

    for (const day of days) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      doc.fontSize(13).fill(charcoal).text(`${day.day} — ${day.focus || ''}`, 50, y);
      y += 22;

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        if (y > 730) {
          doc.addPage();
          y = 50;
        }
        doc.fontSize(10).fill('#333333')
          .text(`  ${ex.name}`, 60, y, { continued: true })
          .fill('#666666')
          .text(`   ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, { align: 'left' });
        y += 16;
        if (ex.notes) {
          doc.fontSize(8).fill('#999999').text(`    ${ex.notes}`, 70, y);
          y += 12;
        }
      }
      y += 12;
    }

    if (workout.cardio) {
      y += 5;
      doc.fontSize(11).fill(gold).text('CARDIO', 50, y);
      y += 18;
      doc.fontSize(10).fill('#333333')
        .text(`${workout.cardio.type || 'Cardio'} — ${workout.cardio.frequency || '3x/week'}, ${workout.cardio.duration || '20 min'}`, 60, y);
      y += 25;
    }

    // Nutrition Plan
    if (y > 550) {
      doc.addPage();
      y = 50;
    }

    y += 10;
    doc.fontSize(18).fill(gold).text('NUTRITION PLAN', 50, y);
    y += 30;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(gold).lineWidth(1).stroke();
    y += 15;

    const nutrition = program.nutrition_plan || program.nutrition || {};

    doc.fontSize(11).fill(charcoal)
      .text(`Calories: ${nutrition.calories || '—'}  |  Protein: ${nutrition.protein_g || '—'}g  |  Carbs: ${nutrition.carbs_g || '—'}g  |  Fat: ${nutrition.fat_g || '—'}g`, 50, y);
    y += 25;

    const meals = nutrition.meals || [];
    for (const meal of meals) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      doc.fontSize(11).fill(charcoal).text(meal.meal || 'Meal', 50, y);
      y += 16;
      const options = meal.options || [];
      for (const opt of options) {
        doc.fontSize(9).fill('#555555').text(`  → ${opt}`, 60, y);
        y += 14;
      }
      y += 8;
    }

    if (nutrition.supplements && nutrition.supplements.length > 0) {
      y += 5;
      doc.fontSize(11).fill(gold).text('SUPPLEMENTS', 50, y);
      y += 18;
      for (const supp of nutrition.supplements) {
        doc.fontSize(9).fill('#555555').text(`  • ${supp}`, 60, y);
        y += 14;
      }
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#AAAAAA')
        .text('Fitness by Maddy — fitnessbymaddy.com', 50, doc.page.height - 40, { align: 'center' });
    }

    doc.end();
  });
}
