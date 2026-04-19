const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone, PROGRAM_NAMES } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    const { data: previousProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, recentCheckins, previousProgram, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout_plan;
      nutritionPlan = parsed.nutrition_plan;
      notes = parsed.notes;
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        workoutPlan = parsed.workout_plan;
        nutritionPlan = parsed.nutrition_plan;
        notes = parsed.notes;
      } else {
        return res.status(500).json({ error: 'Failed to parse program from AI' });
      }
    }

    if (containsRiskyContent(responseText)) {
      const { escalateToMaddy } = require('../lib/escalate');
      await escalateToMaddy(
        'Risky content in generated program',
        client.phone,
        `Week ${week_no}: AI response flagged for review`
      );
      return res.status(200).json({
        flagged: true,
        message: 'Program flagged for manual review',
      });
    }

    const pdfBuffer = await generatePDF(client, workoutPlan, nutritionPlan, notes, week_no);

    const filePath = `${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('[PDF UPLOAD ERROR]', uploadError.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: signedUrl } = await db.storage
      .from('clients')
      .createSignedUrl(filePath, 60 * 60 * 24 * 30);

    const { data: program, error: insertError } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: signedUrl?.signedUrl || filePath,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
      generated_at: new Date().toISOString(),
    }).select().single();

    if (insertError) {
      console.error('[PROGRAM INSERT ERROR]', insertError.message);
    }

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'program_ready',
      params: [
        client.name || 'there',
        `Week ${week_no}`,
        signedUrl?.signedUrl || 'Check your email for the PDF',
      ],
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    console.log(`[PROGRAM] Generated week ${week_no} for ${maskPhone(client.phone)}`);
    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: signedUrl?.signedUrl,
    });
  } catch (err) {
    console.error('[GENERATE PROGRAM ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, previousProgram, weekNo) {
  const checkinSummary = checkins && checkins.length > 0
    ? checkins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')
    : 'No previous check-ins available.';

  const prevPlan = previousProgram
    ? `Previous workout: ${JSON.stringify(previousProgram.workout_plan)}\nPrevious nutrition: ${JSON.stringify(previousProgram.nutrition_plan)}`
    : 'No previous program.';

  return `You are an expert fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Goal: ${client.goal || 'general fitness'}
- Age: ${client.age || 'unknown'}
- Injuries/conditions: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'no restrictions'}
- Schedule: ${client.schedule || 'flexible'}

RECENT CHECK-INS:
${checkinSummary}

PREVIOUS PROGRAM:
${prevPlan}

GENERATE Week ${weekNo} program. Respond ONLY with valid JSON in this exact format:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "description of cardio recommendations",
    "warmup": "warmup protocol"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Meal 1 - Breakfast", "options": ["Option A description", "Option B description"] }
    ],
    "hydration": "water recommendation",
    "supplements": "supplement recommendations if any"
  },
  "notes": "Key focus points for this week, adjustments from last week"
}

RULES:
- Be specific with weights/reps based on check-in data
- Progress logically from previous week
- Never suggest extreme calorie deficits (below BMR - 500)
- Never suggest banned substances or dangerous supplements
- Keep recommendations evidence-based
- Adjust based on energy levels and compliance from check-ins`;
}

function containsRiskyContent(text) {
  const lower = text.toLowerCase();
  const riskyTerms = [
    'dnp', 'clenbuterol', 'anabolic', 'steroid', 'sarm',
    'very low calorie', 'vlcd', 'psmf',
    '800 calories', '700 calories', '600 calories', '500 calories',
    'crash diet', 'water fast', 'dry fast',
  ];
  return riskyTerms.some(term => lower.includes(term));
}

function generatePDF(client, workoutPlan, nutritionPlan, notes, weekNo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const GOLD = '#B8965A';
    const CHARCOAL = '#2C2C2C';
    const LIGHT = '#F0EAE0';

    doc.rect(0, 0, 595, 842).fill(CHARCOAL);
    doc.fontSize(36).fillColor(GOLD).text('FITNESS BY MADDY', 50, 200, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('#FFFFFF').text(`Week ${weekNo} Program`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor(GOLD).text(client.name || 'Client', { align: 'center' });
    doc.moveDown(0.3);
    const programLabel = PROGRAM_NAMES[client.program] || client.program;
    doc.fontSize(10).fillColor('#888888').text(programLabel, { align: 'center' });
    doc.moveDown(0.3);
    doc.text(new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }), { align: 'center' });

    doc.rect(50, 500, 495, 2).fill(GOLD);
    doc.fontSize(9).fillColor('#666666').text('This program is personalized for you. Do not share.', 50, 520, { align: 'center' });

    if (workoutPlan) {
      doc.addPage();
      doc.rect(0, 0, 595, 842).fill('#FFFFFF');

      doc.fontSize(24).fillColor(CHARCOAL).text('WORKOUT PLAN', 50, 50);
      doc.rect(50, 80, 60, 3).fill(GOLD);

      let y = 100;

      if (workoutPlan.warmup) {
        doc.fontSize(10).fillColor(GOLD).text('WARM-UP', 50, y);
        y += 16;
        doc.fontSize(9).fillColor('#444444').text(workoutPlan.warmup, 50, y, { width: 495 });
        y += doc.heightOfString(workoutPlan.warmup, { width: 495 }) + 16;
      }

      if (workoutPlan.days) {
        for (const day of workoutPlan.days) {
          if (y > 700) {
            doc.addPage();
            doc.rect(0, 0, 595, 842).fill('#FFFFFF');
            y = 50;
          }

          doc.rect(50, y, 495, 28).fill(CHARCOAL);
          doc.fontSize(11).fillColor(GOLD).text(day.day.toUpperCase(), 60, y + 8);
          y += 36;

          doc.fontSize(8).fillColor('#888888');
          doc.text('EXERCISE', 60, y);
          doc.text('SETS', 300, y);
          doc.text('REPS', 360, y);
          doc.text('REST', 420, y);
          y += 16;

          if (day.exercises) {
            for (const ex of day.exercises) {
              if (y > 760) {
                doc.addPage();
                doc.rect(0, 0, 595, 842).fill('#FFFFFF');
                y = 50;
              }

              doc.rect(50, y - 2, 495, 20).fill(y % 2 === 0 ? '#FAFAFA' : '#FFFFFF');
              doc.fontSize(9).fillColor(CHARCOAL).text(ex.name, 60, y);
              doc.text(String(ex.sets), 300, y);
              doc.text(String(ex.reps), 360, y);
              doc.text(ex.rest || '-', 420, y);
              y += 22;
            }
          }
          y += 12;
        }
      }

      if (workoutPlan.cardio) {
        if (y > 720) {
          doc.addPage();
          doc.rect(0, 0, 595, 842).fill('#FFFFFF');
          y = 50;
        }
        doc.fontSize(10).fillColor(GOLD).text('CARDIO', 50, y);
        y += 16;
        doc.fontSize(9).fillColor('#444444').text(workoutPlan.cardio, 50, y, { width: 495 });
        y += doc.heightOfString(workoutPlan.cardio, { width: 495 }) + 10;
      }
    }

    if (nutritionPlan) {
      doc.addPage();
      doc.rect(0, 0, 595, 842).fill('#FFFFFF');

      doc.fontSize(24).fillColor(CHARCOAL).text('NUTRITION PLAN', 50, 50);
      doc.rect(50, 80, 60, 3).fill(GOLD);

      let y = 100;

      doc.rect(50, y, 495, 60).fill(CHARCOAL);
      const macroY = y + 10;
      doc.fontSize(10).fillColor(GOLD);

      const macros = [
        { label: 'CALORIES', value: nutritionPlan.calories || '-' },
        { label: 'PROTEIN', value: `${nutritionPlan.protein_g || '-'}g` },
        { label: 'CARBS', value: `${nutritionPlan.carbs_g || '-'}g` },
        { label: 'FAT', value: `${nutritionPlan.fat_g || '-'}g` },
      ];

      macros.forEach((m, i) => {
        const x = 70 + i * 120;
        doc.fontSize(8).fillColor('#888888').text(m.label, x, macroY);
        doc.fontSize(16).fillColor('#FFFFFF').text(String(m.value), x, macroY + 14);
      });

      y += 80;

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) {
            doc.addPage();
            doc.rect(0, 0, 595, 842).fill('#FFFFFF');
            y = 50;
          }

          doc.fontSize(11).fillColor(GOLD).text(meal.meal.toUpperCase(), 50, y);
          y += 18;

          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fillColor('#444444').text(`  ${opt}`, 60, y, { width: 475 });
              y += doc.heightOfString(opt, { width: 475 }) + 6;
            }
          }
          y += 8;
        }
      }

      if (nutritionPlan.hydration) {
        doc.fontSize(10).fillColor(GOLD).text('HYDRATION', 50, y);
        y += 16;
        doc.fontSize(9).fillColor('#444444').text(nutritionPlan.hydration, 50, y, { width: 495 });
        y += 20;
      }

      if (nutritionPlan.supplements) {
        doc.fontSize(10).fillColor(GOLD).text('SUPPLEMENTS', 50, y);
        y += 16;
        doc.fontSize(9).fillColor('#444444').text(nutritionPlan.supplements, 50, y, { width: 495 });
      }
    }

    if (notes) {
      doc.addPage();
      doc.rect(0, 0, 595, 842).fill('#FFFFFF');
      doc.fontSize(24).fillColor(CHARCOAL).text('COACH NOTES', 50, 50);
      doc.rect(50, 80, 60, 3).fill(GOLD);
      doc.fontSize(10).fillColor('#444444').text(notes, 50, 100, { width: 495 });
    }

    doc.addPage();
    doc.rect(0, 0, 595, 842).fill(CHARCOAL);
    doc.fontSize(18).fillColor(GOLD).text('FITNESS BY MADDY', 50, 350, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#888888').text('Your transformation journey continues.', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#666666').text('Questions? Message us on WhatsApp: +917082478374', { align: 'center' });

    doc.end();
  });
}

module.exports.config = {
  maxDuration: 60,
};
