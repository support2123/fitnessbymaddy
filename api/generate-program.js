const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { notifyMaddy } = require('../lib/escalation');
const { sendText, maskPhone } = require('../lib/whatsapp');

const BANNED_KEYWORDS = [
  'steroids', 'anabolic', 'testosterone', 'dnp', 'dinitrophenol',
  'clenbuterol', 'ephedra', 'ephedrine', 'sarms', 'hgh',
  'human growth hormone', 'trenbolone', 'stanozolol', 'nandrolone',
  'amphetamine', 'sibutramine'
];

const BRAND_GOLD = [184, 150, 90];   // #B8965A
const BRAND_BLACK = [20, 20, 20];
const BRAND_WHITE = [255, 255, 255];
const BRAND_GRAY = [100, 100, 100];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Verify internal API key ---
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing required fields: client_id, week_no' });
    }

    // --- Fetch client profile ---
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // --- Fetch last 2 check-ins ---
    const { data: checkins, error: checkinErr } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (checkinErr) {
      console.error('Failed to fetch check-ins:', checkinErr.message);
    }

    const recentCheckins = checkins || [];

    // --- Build prompt ---
    const weightTrend = recentCheckins.length >= 2
      ? `${recentCheckins[1].weight || '?'}kg → ${recentCheckins[0].weight || '?'}kg`
      : recentCheckins.length === 1
        ? `${recentCheckins[0].weight || '?'}kg (first check-in)`
        : 'No previous data';

    const latestCheckin = recentCheckins[0] || {};

    const systemPrompt = `You are an elite fitness program architect for FitnessByMaddy. You create personalized weekly workout and nutrition plans based on client data. Output ONLY valid JSON — no markdown, no code fences, no explanation.`;

    const userPrompt = `Generate a weekly program for the following client:

CLIENT PROFILE:
- Name: ${client.name}
- Program type: ${client.program}
- Current week: ${week_no}
- Age: ${client.age || 'unknown'}
- Gender: ${client.gender || 'female'}
- Height: ${client.height || 'unknown'}
- Current weight: ${latestCheckin.weight || client.weight || 'unknown'}kg
- Goal: ${client.goal || 'general fitness'}
- Equipment access: ${client.equipment || 'full gym'}
- Medical notes: ${client.medical_notes || 'none'}

RECENT CHECK-IN DATA:
- Weight trend: ${weightTrend}
- Compliance score: ${latestCheckin.compliance_score || 'N/A'}/10
- Energy level: ${latestCheckin.energy || 'N/A'}/10
- Issues reported: ${latestCheckin.issues || 'none'}
- Waist measurement: ${latestCheckin.waist || 'N/A'}cm

REQUIREMENTS:
- This is week ${week_no} — progressively overload from prior weeks
- If compliance is low (<6), reduce volume slightly and add motivation notes
- If energy is low (<5), prioritize recovery and reduce intensity
- If issues mention pain or discomfort, modify exercises to avoid that area
- Ensure caloric targets are safe (minimum 1200 kcal for women, 1500 for men)

OUTPUT FORMAT (JSON only):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 3, "reps": "10-12", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 130,
    "carbs_g": 200,
    "fat_g": 55,
    "meals": [
      { "meal": "Breakfast", "description": "Oats with whey and banana", "macros": "P:30g C:50g F:10g" }
    ]
  },
  "coach_notes": "Great progress this week! Keep pushing."
}`;

    // --- Call Claude API ---
    const anthropic = new Anthropic();

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      system: systemPrompt
    });

    const rawResponse = message.content[0].text;

    // --- Parse JSON response ---
    let program;
    try {
      // Try direct parse first, then extract from potential code fences
      const jsonStr = rawResponse.replace(/```json\s*/, '').replace(/```\s*$/, '').trim();
      program = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      console.error('Raw response:', rawResponse.substring(0, 500));
      return res.status(500).json({ error: 'Failed to parse program from AI response' });
    }

    // --- Safety checks ---
    const calories = program.nutrition_plan?.calories;
    if (calories && calories < 1200) {
      console.warn(`Safety flag: calories too low (${calories}) for client ${client_id}`);
      await notifyMaddy(
        'Program Safety Flag — Low Calories',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nCalories: ${calories}\nProgram rejected and needs manual review.`
      );
      return res.status(422).json({ error: 'Program rejected: calorie target too low. Escalated to coach.' });
    }

    const programText = JSON.stringify(program).toLowerCase();
    const foundBanned = BANNED_KEYWORDS.filter((kw) => programText.includes(kw));
    if (foundBanned.length > 0) {
      console.warn(`Safety flag: banned keywords [${foundBanned.join(', ')}] for client ${client_id}`);
      await notifyMaddy(
        'Program Safety Flag — Banned Content',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nBanned keywords found: ${foundBanned.join(', ')}\nProgram rejected and needs manual review.`
      );
      return res.status(422).json({ error: 'Program rejected: contains prohibited content. Escalated to coach.' });
    }

    // --- Generate PDF ---
    const pdfBuffer = await generatePDF(client, week_no, program);

    // --- Upload PDF to Supabase Storage ---
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from('program-pdfs')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload failed:', uploadErr.message);
      return res.status(500).json({ error: 'Failed to upload program PDF' });
    }

    const { data: urlData } = supabase.storage
      .from('program-pdfs')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || '';

    // --- Insert program record ---
    const { data: programRecord, error: progErr } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: program.coach_notes,
        pdf_url: pdfUrl,
        generated_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (progErr) {
      console.error('Program insert failed:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program record' });
    }

    // --- Send PDF link via WhatsApp ---
    const coachNote = program.coach_notes
      ? program.coach_notes.substring(0, 150)
      : 'Your new program is ready!';

    await sendText(
      client.phone,
      `Hey ${client.name}! Your Week ${week_no} program is ready.\n\n${coachNote}\n\nDownload here: ${pdfUrl}`
    );

    console.log(`Program generated: client=${client_id}, week=${week_no}, id=${programRecord.id}`);

    return res.status(200).json({
      success: true,
      pdf_url: pdfUrl,
      program_id: programRecord.id
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// --- PDF Generation ---

function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 80; // 40px margin each side
      const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

      // --- Header (black background, gold text) ---
      doc.rect(0, 0, doc.page.width, 120).fill(`rgb(${BRAND_BLACK.join(',')})`);

      doc.font('Helvetica-Bold')
        .fontSize(28)
        .fillColor(`rgb(${BRAND_GOLD.join(',')})`)
        .text('FITNESSBYMADDY', 40, 30, { width: pageWidth, align: 'center' });

      doc.font('Helvetica')
        .fontSize(12)
        .fillColor(`rgb(${BRAND_WHITE.join(',')})`)
        .text(`${client.name}  |  Week ${weekNo}  |  ${today}`, 40, 70, { width: pageWidth, align: 'center' });

      doc.moveDown(3);
      let yPos = 140;

      // --- Workout Plan ---
      doc.fillColor(`rgb(${BRAND_BLACK.join(',')})`)
        .font('Helvetica-Bold')
        .fontSize(18)
        .text('WORKOUT PLAN', 40, yPos);

      yPos += 30;

      const days = program.workout_plan?.days || [];
      for (const day of days) {
        // Check if we need a new page
        if (yPos > 700) {
          doc.addPage();
          yPos = 40;
        }

        // Day header
        doc.rect(40, yPos, pageWidth, 24)
          .fill(`rgb(${BRAND_GOLD.join(',')})`);

        doc.font('Helvetica-Bold')
          .fontSize(11)
          .fillColor(`rgb(${BRAND_WHITE.join(',')})`)
          .text(`${day.day} — ${day.focus}`, 50, yPos + 6, { width: pageWidth - 20 });

        yPos += 30;

        // Column headers
        doc.font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(`rgb(${BRAND_GRAY.join(',')})`);

        doc.text('EXERCISE', 50, yPos, { width: 160 });
        doc.text('SETS', 220, yPos, { width: 40 });
        doc.text('REPS', 270, yPos, { width: 60 });
        doc.text('REST', 340, yPos, { width: 50 });
        doc.text('NOTES', 400, yPos, { width: 140 });

        yPos += 16;

        // Exercises
        const exercises = day.exercises || [];
        for (const ex of exercises) {
          if (yPos > 740) {
            doc.addPage();
            yPos = 40;
          }

          doc.font('Helvetica')
            .fontSize(9)
            .fillColor(`rgb(${BRAND_BLACK.join(',')})`);

          doc.text(ex.name || '', 50, yPos, { width: 160 });
          doc.text(String(ex.sets || ''), 220, yPos, { width: 40 });
          doc.text(String(ex.reps || ''), 270, yPos, { width: 60 });
          doc.text(ex.rest || '', 340, yPos, { width: 50 });
          doc.text(ex.notes || '', 400, yPos, { width: 140 });

          yPos += 16;
        }

        yPos += 10;
      }

      // --- Nutrition Plan ---
      if (yPos > 600) {
        doc.addPage();
        yPos = 40;
      }

      yPos += 10;

      doc.font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(`rgb(${BRAND_BLACK.join(',')})`)
        .text('NUTRITION PLAN', 40, yPos);

      yPos += 30;

      const np = program.nutrition_plan || {};

      // Macro summary bar
      doc.rect(40, yPos, pageWidth, 36)
        .fill(`rgb(${BRAND_BLACK.join(',')})`);

      doc.font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(`rgb(${BRAND_GOLD.join(',')})`);

      const macroText = `Calories: ${np.calories || '—'}  |  Protein: ${np.protein_g || '—'}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fat: ${np.fat_g || '—'}g`;
      doc.text(macroText, 50, yPos + 12, { width: pageWidth - 20, align: 'center' });

      yPos += 46;

      // Meals
      const meals = np.meals || [];
      for (const meal of meals) {
        if (yPos > 720) {
          doc.addPage();
          yPos = 40;
        }

        doc.font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(`rgb(${BRAND_GOLD.join(',')})`)
          .text(meal.meal || '', 50, yPos);

        yPos += 14;

        doc.font('Helvetica')
          .fontSize(9)
          .fillColor(`rgb(${BRAND_BLACK.join(',')})`)
          .text(meal.description || '', 50, yPos, { width: pageWidth - 20 });

        yPos += 14;

        if (meal.macros) {
          doc.font('Helvetica')
            .fontSize(8)
            .fillColor(`rgb(${BRAND_GRAY.join(',')})`)
            .text(meal.macros, 50, yPos, { width: pageWidth - 20 });
          yPos += 12;
        }

        yPos += 6;
      }

      // --- Coach Notes ---
      if (program.coach_notes) {
        if (yPos > 680) {
          doc.addPage();
          yPos = 40;
        }

        yPos += 10;

        doc.font('Helvetica-Bold')
          .fontSize(14)
          .fillColor(`rgb(${BRAND_BLACK.join(',')})`)
          .text('COACH NOTES', 40, yPos);

        yPos += 22;

        doc.font('Helvetica')
          .fontSize(10)
          .fillColor(`rgb(${BRAND_BLACK.join(',')})`)
          .text(program.coach_notes, 50, yPos, {
            width: pageWidth - 20,
            lineGap: 4
          });
      }

      // --- Footer ---
      const footerY = doc.page.height - 40;
      doc.font('Helvetica')
        .fontSize(7)
        .fillColor(`rgb(${BRAND_GRAY.join(',')})`)
        .text('FitnessByMaddy — This program is personalized. Do not share.', 40, footerY, {
          width: pageWidth,
          align: 'center'
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
