const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'starvation',
  'banned substance', 'steroid', 'ephedra', 'dnp',
  'lose 10kg in 1 week', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for Fitness by Maddy.
Create a weekly training and nutrition program. Output valid JSON only.

Format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "cardio": { "type": "LISS", "duration": "30min", "frequency": "3x/week" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Oats + whey + banana", "Eggs + toast + avocado"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3L water daily"
  },
  "coach_note": "One line motivational note for the client"
}

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- Adjust based on check-in data (compliance, energy, weight trend)
- If client reports pain/injury, reduce intensity and flag for review
- Keep it practical and sustainable`;

    const userPrompt = `Client profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${client.goal || 'general fitness'}
- Injuries/limitations: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'no restrictions'}
- Schedule: ${client.schedule || 'flexible'}
- Age: ${client.age || 'not specified'}

Week ${week_no} of ${client.program === '12wk' ? '12' : '6'}.

${recentCheckins && recentCheckins.length > 0 ? `Recent check-ins:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No previous check-ins yet.'}

${lastProgram ? `Last week's plan summary:
Calories: ${lastProgram.nutrition_plan?.calories || '?'}, Protein: ${lastProgram.nutrition_plan?.protein_g || '?'}g` : ''}

Generate the Week ${week_no} program as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude did not return valid JSON');
    }

    const programData = JSON.parse(jsonMatch[0]);

    const flagged = SAFETY_FLAGS.some(flag =>
      responseText.toLowerCase().includes(flag)
    );

    if (flagged) {
      const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
      await sendWhatsApp(
        maddyPhone,
        `SAFETY FLAG: Program for ${maskPhone(client.phone)} Week ${week_no} contains flagged content. Review before sending.`,
        'escalation_alert'
      );

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || null,
        nutrition_plan: programData.nutrition_plan || null,
        notes: 'FLAGGED FOR REVIEW: ' + (programData.coach_note || ''),
        generated_at: new Date().toISOString()
      });

      return res.json({ success: true, flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData.publicUrl;

    const { error: dbError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan || null,
      nutrition_plan: programData.nutrition_plan || null,
      notes: programData.coach_note || '',
      pdf_url: pdfUrl,
      generated_at: new Date().toISOString()
    });

    if (dbError) throw dbError;

    const coachNote = programData.coach_note || 'Your new program is ready!';
    await sendWhatsApp(
      client.phone,
      `Week ${week_no} Program Ready!\n\n${coachNote}\n\nDownload: ${pdfUrl}`
    );

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function generatePDF(client, weekNo, data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header - black bar with gold text
    doc.rect(0, 0, 595.28, 100).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 30, { width: 495 });
    doc.fontSize(12).fill('#C8B89A')
      .text(`WEEK ${weekNo} PROGRAM | ${(client.name || 'CLIENT').toUpperCase()}`, 50, 65, { width: 495 });

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    // Workout Plan
    if (data.workout_plan) {
      doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
      doc.moveDown(0.5);

      const days = data.workout_plan.days || [];
      for (const day of days) {
        if (doc.y > 700) { doc.addPage(); doc.y = 50; }

        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        const exercises = day.exercises || [];
        for (const ex of exercises) {
          doc.fontSize(10).fill('#6B6B6B')
            .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  |  ' + ex.notes : ''}`, 60, doc.y, { width: 480 });
          doc.moveDown(0.2);
        }
        doc.moveDown(0.5);
      }

      if (data.workout_plan.cardio) {
        const c = data.workout_plan.cardio;
        doc.fontSize(11).fill('#2C2C2C').text(`Cardio: ${c.type} — ${c.duration}, ${c.frequency}`, 50);
        doc.moveDown(0.5);
      }

      if (data.workout_plan.rest_days) {
        doc.fontSize(11).fill('#6B6B6B')
          .text(`Rest Days: ${data.workout_plan.rest_days.join(', ')}`, 50);
      }
    }

    doc.moveDown(1.5);

    // Nutrition Plan
    if (data.nutrition_plan) {
      if (doc.y > 600) doc.addPage();

      doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
      doc.moveDown(0.5);

      const n = data.nutrition_plan;
      doc.fontSize(12).fill('#2C2C2C')
        .text(`Daily Targets: ${n.calories} kcal  |  Protein: ${n.protein_g}g  |  Carbs: ${n.carbs_g}g  |  Fat: ${n.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (n.meals) {
        for (const meal of n.meals) {
          doc.fontSize(11).fill('#2C2C2C').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`  → ${opt}`, 60);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (n.supplements && n.supplements.length > 0) {
        doc.moveDown(0.3);
        doc.fontSize(11).fill('#2C2C2C').text('Supplements:', 50);
        doc.fontSize(10).fill('#6B6B6B').text(`  ${n.supplements.join(', ')}`, 60);
      }

      if (n.hydration) {
        doc.fontSize(10).fill('#6B6B6B').text(`  Hydration: ${n.hydration}`, 60);
      }
    }

    // Coach Note
    if (data.coach_note) {
      doc.moveDown(1.5);
      if (doc.y > 700) doc.addPage();
      doc.rect(50, doc.y, 495, 40).fill('#FAF8F4');
      doc.fontSize(11).fill('#B8965A').text(`Coach's Note: ${data.coach_note}`, 60, doc.y - 30, { width: 475 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#C8B89A')
        .text('fitnessbymaddy.com | Confidential — for personal use only', 50, 780, { width: 495, align: 'center' });
    }

    doc.end();
  });
}
