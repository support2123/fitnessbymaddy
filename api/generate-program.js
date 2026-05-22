const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');

const RISKY_PATTERNS = [
  /(\b\d{2,3}0\+?\s*cal(orie)?s?\s*(deficit|cut))/i,
  /below\s*(800|900|1000)\s*cal/i,
  /clenbuterol|dnp|ephedra|sarms|steroids/i,
  /lose\s*\d+\s*(kg|lbs?)\s*in\s*(1|2|3)\s*days?/i,
];

function containsRiskyContent(text) {
  return RISKY_PATTERNS.some(pattern => pattern.test(text));
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
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

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

    const { data: previousPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified personal trainer and nutrition coach working for Fitness by Maddy, an elite online coaching brand. Generate a weekly training and nutrition program based on the client's profile and recent check-in data.

RULES:
- Programs must be safe, evidence-based, and progressive
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Adapt intensity based on compliance scores and energy levels
- Consider reported injuries or issues
- Output valid JSON only

OUTPUT FORMAT:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "15 min incline walk"
      }
    ],
    "weekly_notes": "Focus on progressive overload this week"
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meal_timing": ["Meal 1: 8am", "Meal 2: 12pm", "Meal 3: 4pm", "Meal 4: 8pm"],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Multivitamin"],
    "notes": "Increase carbs on training days by 30g"
  },
  "coach_note": "Great progress last week. This week we push intensity slightly."
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

${recentCheckins && recentCheckins.length > 0
  ? `RECENT CHECK-INS:\n${recentCheckins.map(c => `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}`
  : 'No previous check-ins (first week).'}

${previousPrograms && previousPrograms.length > 0
  ? `PREVIOUS WEEK PLAN SUMMARY:\n  ${previousPrograms[0].notes || 'Standard progression'}`
  : 'No previous program (generate initial week).'}

Generate the Week ${week_no} program JSON now.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from Claude response');
    }

    const programData = JSON.parse(jsonMatch[0]);

    if (containsRiskyContent(JSON.stringify(programData))) {
      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'FLAGGED FOR REVIEW - Potentially risky content detected',
      });

      const { notifyMaddy } = require('./lib/escalation');
      await notifyMaddy('Program flagged for risky content', {
        client_id,
        phone: maskPhone(client.phone),
        week_no,
      }, sendWhatsApp);

      return res.status(200).json({ success: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note || null,
      })
      .select()
      .single();

    const coachNote = programData.coach_note || `Your Week ${week_no} program is ready!`;
    await sendWhatsApp(
      client.phone,
      `Week ${week_no} Program Ready!\n\n${coachNote}\n\nYour PDF: ${pdfUrl}`,
      null,
      true
    );

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

async function generatePDF(programData, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fillColor('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fillColor('#FFFFFF').fontSize(14).text(`Week ${weekNo} Program`, 50, 75, { align: 'center' });
    doc.fillColor('#999999').fontSize(10).text(`${client.name || 'Client'} | ${client.program}`, 50, 95, { align: 'center' });

    doc.fillColor('#2C2C2C');
    let y = 145;

    if (programData.workout_plan?.days) {
      doc.fillColor('#B8965A').fontSize(18).text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of programData.workout_plan.days) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }

        doc.fillColor('#2C2C2C').fontSize(13).text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fillColor('#6B6B6B').fontSize(10)
              .text(`  ${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}`, 50, y);
            y += 15;
          }
        }

        if (day.cardio) {
          doc.fillColor('#B8965A').fontSize(10).text(`  Cardio: ${day.cardio}`, 50, y);
          y += 15;
        }

        y += 10;
      }
    }

    if (programData.nutrition_plan) {
      if (y > 600) {
        doc.addPage();
        y = 50;
      }

      y += 10;
      doc.fillColor('#B8965A').fontSize(18).text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = programData.nutrition_plan;
      doc.fillColor('#2C2C2C').fontSize(11);
      doc.text(`Daily Calories: ${np.daily_calories} kcal`, 50, y); y += 18;
      doc.text(`Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`, 50, y); y += 18;
      doc.text(`Hydration: ${np.hydration || '3-4L water'}`, 50, y); y += 25;

      if (np.meal_timing) {
        doc.fillColor('#6B6B6B').fontSize(10);
        for (const meal of np.meal_timing) {
          doc.text(`  ${meal}`, 50, y); y += 14;
        }
      }

      if (np.notes) {
        y += 10;
        doc.fillColor('#B8965A').fontSize(10).text(`Note: ${np.notes}`, 50, y);
      }
    }

    if (programData.coach_note) {
      doc.addPage();
      doc.fillColor('#B8965A').fontSize(18).text("COACH'S NOTE", 50, 50);
      doc.fillColor('#2C2C2C').fontSize(12).text(programData.coach_note, 50, 80, { width: 500 });
    }

    doc.end();
  });
}
