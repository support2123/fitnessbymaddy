const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /clenbuterol|dnp|ephedra|sarm|steroid/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i,
  /starvation|extreme\s*cut|zero\s*carb\s*for\s*weeks/i
];

function checkProgramSafety(text) {
  for (const pattern of RISKY_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

async function generateWithClaude(clientData, checkins) {
  const anthropic = new Anthropic();

  const lastCheckins = checkins.slice(-2).map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues
  }));

  const prompt = `You are a certified fitness program architect for FitnessByMaddy.

Client Profile:
- Name: ${clientData.name || 'Client'}
- Program: ${clientData.program}
- Week: ${clientData.targetWeek}

Recent Check-in Data:
${JSON.stringify(lastCheckins, null, 2)}

Generate a weekly program in this exact JSON format:
{
  "workout_plan": {
    "overview": "Brief week focus",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20min LISS post-workout"
      }
    ],
    "rest_days": ["Sunday"],
    "notes": "Progressive overload from last week"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fats_g": 70,
    "meal_timing": ["Pre-workout: 2hrs before", "Post-workout: within 45min"],
    "hydration": "3-4L daily",
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": "Adjust carbs on rest days (-30g)"
  }
}

Rules:
- Be evidence-based and conservative
- Never prescribe extreme calorie deficits (minimum 1400 for women, 1600 for men)
- Never recommend banned substances
- Adjust based on compliance score and energy levels from check-ins
- If compliance was low, simplify the plan
- If energy was low, reduce volume slightly

Return ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  return response.content[0].text;
}

function buildPDF(clientName, weekNo, workout, nutrition) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 100).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(14).fill('#FFFFFF').font('Helvetica')
      .text(`Week ${weekNo} Program — ${clientName}`, 50, 65);

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    // Workout Plan
    doc.fontSize(20).font('Helvetica-Bold').text('WORKOUT PLAN', 50, 130);
    doc.moveTo(50, 155).lineTo(545, 155).strokeColor('#B8965A').lineWidth(2).stroke();

    let y = 170;
    if (workout.overview) {
      doc.fontSize(11).font('Helvetica').fill('#6B6B6B').text(workout.overview, 50, y, { width: 495 });
      y += 30;
    }

    if (workout.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(14).font('Helvetica-Bold').fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50, y);
        y += 22;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).font('Helvetica').fill('#2C2C2C')
              .text(`• ${ex.name}`, 60, y)
              .text(`${ex.sets}×${ex.reps} | Rest: ${ex.rest}`, 300, y);
            y += 16;
            if (ex.notes) {
              doc.fontSize(9).fill('#6B6B6B').text(`  ${ex.notes}`, 70, y);
              y += 14;
            }
          }
        }

        if (day.cardio) {
          doc.fontSize(10).font('Helvetica').fill('#B8965A').text(`Cardio: ${day.cardio}`, 60, y);
          y += 20;
        }
        y += 10;
      }
    }

    // Nutrition Plan
    doc.addPage();
    doc.rect(0, 0, 595, 60).fill('#2C2C2C');
    doc.fontSize(20).fill('#B8965A').font('Helvetica-Bold').text('NUTRITION PLAN', 50, 20);

    y = 80;
    if (nutrition.calories) {
      doc.fontSize(12).fill('#2C2C2C').font('Helvetica-Bold')
        .text(`Daily Target: ${nutrition.calories} kcal`, 50, y);
      y += 25;
      doc.fontSize(11).font('Helvetica').fill('#6B6B6B')
        .text(`Protein: ${nutrition.protein_g}g | Carbs: ${nutrition.carbs_g}g | Fats: ${nutrition.fats_g}g`, 50, y);
      y += 30;
    }

    if (nutrition.meal_timing) {
      doc.fontSize(12).font('Helvetica-Bold').fill('#2C2C2C').text('Meal Timing', 50, y);
      y += 20;
      for (const timing of nutrition.meal_timing) {
        doc.fontSize(10).font('Helvetica').fill('#6B6B6B').text(`• ${timing}`, 60, y);
        y += 16;
      }
      y += 10;
    }

    if (nutrition.supplements) {
      doc.fontSize(12).font('Helvetica-Bold').fill('#2C2C2C').text('Supplements', 50, y);
      y += 20;
      for (const supp of nutrition.supplements) {
        doc.fontSize(10).font('Helvetica').fill('#6B6B6B').text(`• ${supp}`, 60, y);
        y += 16;
      }
      y += 10;
    }

    if (nutrition.notes) {
      doc.fontSize(10).font('Helvetica').fill('#B8965A').text(nutrition.notes, 50, y, { width: 495 });
    }

    // Footer on every page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#C8B89A')
        .text('fitnessbymaddy.com | For personal use only', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const { data: client } = await supabase
    .from('clients').select('*').eq('id', client_id).single();
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: checkins } = await supabase
    .from('checkins').select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const clientData = { ...client, targetWeek: week_no };
  let programJson;

  try {
    const rawOutput = await generateWithClaude(clientData, checkins || []);
    programJson = JSON.parse(rawOutput);
  } catch (err) {
    console.error('Claude API / parse error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  const fullText = JSON.stringify(programJson);
  if (!checkProgramSafety(fullText)) {
    await escalateToMaddy('Program flagged for risky content', {
      phone: client.phone,
      details: `Week ${week_no} program contained restricted content — held for review`
    });
    return res.status(200).json({ ok: false, held: true, reason: 'Flagged for review' });
  }

  const pdfBuffer = await buildPDF(
    client.name || 'Client',
    week_no,
    programJson.workout_plan || {},
    programJson.nutrition_plan || {}
  );

  const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('programs')
    .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

  if (uploadError) {
    console.error('PDF upload error:', uploadError);
    return res.status(500).json({ error: 'PDF upload failed' });
  }

  const { data: publicUrl } = supabase.storage
    .from('programs')
    .getPublicUrl(filePath);

  const { error: dbError } = await supabase.from('programs').insert({
    client_id,
    week_no,
    pdf_url: publicUrl.publicUrl,
    workout_plan: programJson.workout_plan,
    nutrition_plan: programJson.nutrition_plan,
    notes: programJson.workout_plan?.notes || null
  });

  if (dbError) {
    console.error('Program DB save error:', dbError);
    return res.status(500).json({ error: 'Failed to save program record' });
  }

  const market = detectMarket(client.phone);
  const templateName = isHinglish(market) ? 'weekly_program_hi' : 'weekly_program';
  await sendTemplate(client.phone, templateName, [
    client.name || 'there',
    String(week_no),
    publicUrl.publicUrl
  ]);

  await supabase.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ ok: true, client_id, week_no, pdf_url: publicUrl.publicUrl });
};
