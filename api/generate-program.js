const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendText, notifyMaddy, maskPhone, detectMarket, isHinglish } = require('./lib/whatsapp');

const UNSAFE_PATTERNS = [
  /less than 1[,.]?[0-2]00\s*cal/i,
  /under 1[,.]?[0-2]00\s*cal/i,
  /\b(dnp|clenbuterol|ephedra|sarms|steroids|hgh|testosterone)\b/i,
  /lose\s+\d{2,}\s*(kg|lbs?|pounds?)\s*(in|within)\s*(1|2|one|two)\s*week/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = {};
    if (intakeMsg?.body) {
      try { intakeData = JSON.parse(intakeMsg.body); } catch (e) { /* ignore */ }
    }

    const prompt = buildPrompt(client, intakeData, recentCheckins || [], week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0]?.text || '';

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(content)) {
        await notifyMaddy('Program generation safety flag', {
          phone: maskPhone(client.phone),
          message: `Week ${week_no} program for ${client.name || 'Unknown'} flagged for review. Pattern: ${pattern.source}`
        });
        return res.status(200).json({ status: 'flagged', reason: 'safety_review' });
      }
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch (e) {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: parsed.workout_plan || parsed,
      nutrition_plan: parsed.nutrition_plan || {},
      notes: parsed.coach_notes || null
    }).select().single();

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const msg = hinglish
      ? `Hey ${client.name || 'Champion'}! 🔥\n\nTumhara Week ${week_no} ka program ready hai!\n\n📄 PDF: ${publicUrl?.publicUrl || 'Check your folder'}\n\n${parsed.coach_notes ? `💡 Note: ${parsed.coach_notes}` : 'Let\'s crush this week! 💪'}`
      : `Hey ${client.name || 'Champion'}! 🔥\n\nYour Week ${week_no} program is ready!\n\n📄 PDF: ${publicUrl?.publicUrl || 'Check your folder'}\n\n${parsed.coach_notes ? `💡 Note: ${parsed.coach_notes}` : 'Let\'s crush this week! 💪'}`;

    await sendText(client.phone, msg);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ status: 'ok', program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues: ${c.issues || 'None'}`
  ).join('\n');

  return `You are an expert fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Current Week: ${weekNo}

INTAKE DATA:
- Age: ${intake.age || 'N/A'}
- Gender: ${intake.gender || 'N/A'}
- Height: ${intake.height || 'N/A'}
- Weight: ${intake.weight || 'N/A'}
- Goal: ${intake.goal || 'General fitness'}
- Injuries: ${intake.injuries || 'None'}
- Diet Preference: ${intake.diet_preference || 'No restrictions'}
- Schedule: ${intake.workout_schedule || 'Flexible'}
- Fitness Level: ${intake.current_fitness_level || 'Intermediate'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins'}

Create a Week ${weekNo} program. Return JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min light cardio + dynamic stretches",
        "cooldown": "5 min static stretching"
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 73,
    "meal_timing": ["Meal 1: 8am", "Meal 2: 12pm", "Meal 3: 4pm", "Meal 4: 8pm"],
    "sample_meals": ["Oats + whey + banana", "Chicken + rice + veggies", "Greek yogurt + nuts"],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Multivitamin"]
  },
  "coach_notes": "Brief motivational/adjustment note for the client"
}

RULES:
- Never prescribe less than 1200 calories for women or 1500 for men
- Never recommend banned substances or steroids
- Progress gradually — no extreme jumps in volume or intensity
- Account for any injuries or limitations
- If compliance was low last week, reduce volume slightly and add notes
- If energy was low, review nutrition and recovery recommendations
- Keep it practical and sustainable`;
}

async function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 70, { align: 'center' });
    doc.fill('#D4AF7A').fontSize(11)
      .text(`${client.name || 'Client'} | ${new Date().toLocaleDateString('en-GB')}`, 50, 92, { align: 'center' });

    doc.moveDown(4);

    const workout = program.workout_plan;
    if (workout?.days) {
      doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      doc.rect(50, doc.y, 100, 3).fill('#B8965A');
      doc.moveDown(1);

      for (const day of workout.days) {
        if (doc.y > 680) { doc.addPage(); }

        doc.fill('#2C2C2C').fontSize(14).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus || ''}`, 50);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
            .text(`Warm-up: ${day.warmup}`, 60);
        }
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#2C2C2C').fontSize(11).font('Helvetica')
              .text(`• ${ex.name}  —  ${ex.sets} × ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60);
            if (ex.notes) {
              doc.fill('#6B6B6B').fontSize(9).text(`  ${ex.notes}`, 70);
            }
          }
        }

        if (day.cooldown) {
          doc.moveDown(0.2);
          doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
            .text(`Cool-down: ${day.cooldown}`, 60);
        }
        doc.moveDown(1);
      }
    }

    const nutrition = program.nutrition_plan;
    if (nutrition) {
      if (doc.y > 500) { doc.addPage(); }

      doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);
      doc.rect(50, doc.y, 100, 3).fill('#B8965A');
      doc.moveDown(1);

      if (nutrition.daily_calories) {
        doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold')
          .text('Daily Targets', 50);
        doc.fill('#2C2C2C').fontSize(11).font('Helvetica')
          .text(`Calories: ${nutrition.daily_calories} kcal  |  Protein: ${nutrition.protein_g || '—'}g  |  Carbs: ${nutrition.carbs_g || '—'}g  |  Fat: ${nutrition.fat_g || '—'}g`, 60);
        doc.moveDown(0.8);
      }

      if (nutrition.meal_timing) {
        doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold')
          .text('Meal Timing', 50);
        for (const meal of nutrition.meal_timing) {
          doc.fill('#2C2C2C').fontSize(11).font('Helvetica').text(`• ${meal}`, 60);
        }
        doc.moveDown(0.8);
      }

      if (nutrition.sample_meals) {
        doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold')
          .text('Sample Meals', 50);
        for (const meal of nutrition.sample_meals) {
          doc.fill('#2C2C2C').fontSize(11).font('Helvetica').text(`• ${meal}`, 60);
        }
        doc.moveDown(0.8);
      }

      if (nutrition.hydration) {
        doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
          .text(`💧 Hydration: ${nutrition.hydration}`, 60);
      }
    }

    if (program.coach_notes) {
      if (doc.y > 650) { doc.addPage(); }
      doc.moveDown(2);
      doc.rect(50, doc.y, doc.page.width - 100, 1).fill('#E8E3DC');
      doc.moveDown(1);
      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold')
        .text('Coach\'s Note', 50);
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica')
        .text(program.coach_notes, 50, undefined, { width: doc.page.width - 100 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fill('#C8B89A').fontSize(8)
        .text('© Fitness by Maddy | fitnessbymaddy.com', 50, doc.page.height - 40, { align: 'center' });
    }

    doc.end();
  });
}
