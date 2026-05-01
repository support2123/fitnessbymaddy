const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { cors, maskPhone } = require('./_lib/helpers');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: previousProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      intake: client.intake_data || {},
      recentCheckins: recentCheckins || [],
      previousPlan: previousProgram || null
    };

    const systemPrompt = `You are Maddy's program architect — an expert fitness coach and nutritionist.
You design weekly workout and nutrition plans for clients in Maddy's coaching business.

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned or dangerous supplements
- Never promise specific results timelines
- Base progressions on the client's recent check-in data
- If the client reported pain or injury, flag it and reduce intensity
- Format output as valid JSON with "workout_plan" and "nutrition_plan" keys
- Include day-by-day breakdown for workouts (6 days on, 1 rest)
- Include macro targets, meal timing, and 2-3 meal suggestions per slot
- Add a "coach_notes" field with a 2-3 sentence personalised note from Maddy`;

    const userPrompt = `Generate Week ${week_no} program for this client:

${JSON.stringify(clientProfile, null, 2)}

Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "overview": "...",
    "days": [
      { "day": 1, "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }] }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "slot": "Breakfast", "time": "8:00 AM", "options": ["...", "..."] }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "coach_notes": "..."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;
    let programData;

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Program generation parse error' });
    }

    if (isFlagged(programData)) {
      const { notifyMaddy } = require('./_lib/whatsapp');
      await notifyMaddy(
        'Program flagged for review — potential safety concern',
        client.phone,
        `Week ${week_no}: ${programData.coach_notes || 'Check generated plan'}`
      );
      return res.status(200).json({ flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client.id}/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData ? urlData.publicUrl : storagePath;

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || null
    });

    await sendTemplate(client.phone, 'program_ready', [
      client.name || 'there',
      String(week_no),
      programData.coach_notes || `Your Week ${week_no} plan is ready!`
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function isFlagged(programData) {
  const json = JSON.stringify(programData).toLowerCase();
  if (programData.nutrition_plan) {
    const cals = programData.nutrition_plan.daily_calories;
    if (cals && cals < 1200) return true;
  }
  const banned = ['steroids', 'sarms', 'clenbuterol', 'dnp', 'ephedra', 'hgh injections'];
  return banned.some(term => json.includes(term));
}

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fillColor(gold).text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(12).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 70);
    doc.fontSize(10).fillColor('#999999')
      .text(`Prepared for ${client.name || 'Client'} | ${new Date().toLocaleDateString()}`, 50, 90);

    doc.moveDown(4);

    // Workout Plan
    doc.fontSize(18).fillColor(gold).text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (programData.workout_plan) {
      if (programData.workout_plan.overview) {
        doc.fontSize(10).fillColor(charcoal).text(programData.workout_plan.overview, 50);
        doc.moveDown(0.5);
      }

      const days = programData.workout_plan.days || [];
      for (const day of days) {
        doc.moveDown(0.3);
        doc.fontSize(12).fillColor(gold)
          .text(`Day ${day.day}: ${day.focus || ''}`, 50);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(9).fillColor(charcoal)
              .text(`  • ${ex.name} — ${ex.sets}x${ex.reps} | Rest: ${ex.rest || '60s'}`, 60);
            if (ex.notes) {
              doc.fontSize(8).fillColor('#666666')
                .text(`    ${ex.notes}`, 70);
            }
          }
        }

        if (doc.y > doc.page.height - 100) {
          doc.addPage();
        }
      }
    }

    doc.addPage();

    // Nutrition Plan
    doc.fontSize(18).fillColor(gold).text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    if (programData.nutrition_plan) {
      const np = programData.nutrition_plan;
      doc.fontSize(11).fillColor(charcoal)
        .text(`Daily Calories: ${np.daily_calories || 'TBD'} kcal`, 50);
      doc.text(`Protein: ${np.protein_g || '-'}g | Carbs: ${np.carbs_g || '-'}g | Fat: ${np.fat_g || '-'}g`, 50);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).fillColor(gold)
            .text(`${meal.slot} (${meal.time || ''})`, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fillColor(charcoal).text(`  • ${opt}`, 60);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor(charcoal).text(`Hydration: ${np.hydration}`, 50);
      }

      if (np.supplements && np.supplements.length > 0) {
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor(charcoal)
          .text(`Supplements: ${np.supplements.join(', ')}`, 50);
      }
    }

    // Coach Notes
    if (programData.coach_notes) {
      doc.moveDown(1);
      doc.rect(50, doc.y, doc.page.width - 100, 1).fill(gold);
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor(gold).text("COACH'S NOTE", 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor(charcoal).text(programData.coach_notes, 50, doc.y, {
        width: doc.page.width - 100
      });
    }

    // Footer
    doc.fontSize(8).fillColor('#999999')
      .text('© Fitness by Maddy | fitnessbymaddy.com', 50, doc.page.height - 40, {
        align: 'center', width: doc.page.width - 100
      });

    doc.end();
  });
}
