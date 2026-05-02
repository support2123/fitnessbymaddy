const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const supabase = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const BANNED_KEYWORDS = ['steroid', 'dnp', 'clenbuterol', 'ephedrine', 'extreme deficit'];

function containsBannedContent(plan) {
  const text = JSON.stringify(plan).toLowerCase();
  return BANNED_KEYWORDS.find((kw) => text.includes(kw)) || null;
}

function generatePDF(programData, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const BRAND_BLACK = '#2C2C2C';
    const BRAND_GOLD = '#B8965A';
    const WHITE = '#FFFFFF';
    const LIGHT_GRAY = '#F5F5F5';
    const pageWidth = doc.page.width - 100; // margin * 2

    // --- Header ---
    doc.rect(0, 0, doc.page.width, 120).fill(BRAND_BLACK);
    doc.fontSize(28).font('Helvetica-Bold').fillColor(BRAND_GOLD)
      .text('FITNESS BY MADDY', 50, 35, { width: pageWidth, align: 'center' });
    doc.fontSize(14).font('Helvetica').fillColor(WHITE)
      .text(`Week ${weekNo} Program`, 50, 75, { width: pageWidth, align: 'center' });
    doc.fontSize(10).fillColor(WHITE)
      .text(`Prepared for ${client.name}`, 50, 95, { width: pageWidth, align: 'center' });

    doc.moveDown(4);
    let y = 150;

    // --- Workout Plan ---
    doc.fontSize(16).font('Helvetica-Bold').fillColor(BRAND_GOLD)
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    const workout = programData.workout_plan;
    if (workout && workout.days) {
      for (const day of workout.days) {
        // Check if we need a new page
        if (y > doc.page.height - 200) {
          doc.addPage();
          y = 50;
        }

        doc.rect(50, y, pageWidth, 24).fill(BRAND_BLACK);
        doc.fontSize(12).font('Helvetica-Bold').fillColor(BRAND_GOLD)
          .text(`${day.day} — ${day.focus}`, 58, y + 6, { width: pageWidth - 16 });
        y += 30;

        if (day.warmup) {
          doc.fontSize(9).font('Helvetica-Bold').fillColor(BRAND_BLACK)
            .text('Warm-up: ', 58, y, { continued: true });
          doc.font('Helvetica').text(day.warmup);
          y += 18;
        }

        // Exercise table header
        doc.rect(50, y, pageWidth, 18).fill(LIGHT_GRAY);
        doc.fontSize(8).font('Helvetica-Bold').fillColor(BRAND_BLACK);
        doc.text('Exercise', 58, y + 4, { width: 180 });
        doc.text('Sets', 240, y + 4, { width: 40 });
        doc.text('Reps', 290, y + 4, { width: 60 });
        doc.text('Rest', 360, y + 4, { width: 40 });
        doc.text('Notes', 410, y + 4, { width: 130 });
        y += 22;

        for (let i = 0; i < (day.exercises || []).length; i++) {
          const ex = day.exercises[i];
          if (y > doc.page.height - 80) {
            doc.addPage();
            y = 50;
          }

          if (i % 2 === 1) {
            doc.rect(50, y - 2, pageWidth, 16).fill('#FAFAFA');
          }

          doc.fontSize(8).font('Helvetica').fillColor(BRAND_BLACK);
          doc.text(ex.name || '', 58, y, { width: 180 });
          doc.text(String(ex.sets || ''), 240, y, { width: 40 });
          doc.text(String(ex.reps || ''), 290, y, { width: 60 });
          doc.text(String(ex.rest || ''), 360, y, { width: 40 });
          doc.text(ex.notes || '', 410, y, { width: 130 });
          y += 18;
        }

        if (day.cooldown) {
          doc.fontSize(9).font('Helvetica-Bold').fillColor(BRAND_BLACK)
            .text('Cool-down: ', 58, y + 4, { continued: true });
          doc.font('Helvetica').text(day.cooldown);
          y += 18;
        }

        y += 12;
      }
    }

    // --- Nutrition Plan ---
    if (y > doc.page.height - 250) {
      doc.addPage();
      y = 50;
    }

    doc.fontSize(16).font('Helvetica-Bold').fillColor(BRAND_GOLD)
      .text('NUTRITION PLAN', 50, y);
    y += 28;

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      // Macro summary bar
      doc.rect(50, y, pageWidth, 30).fill(BRAND_BLACK);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(BRAND_GOLD);
      const macroText = `Calories: ${nutrition.daily_calories} kcal  |  Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fat: ${nutrition.fat_g}g`;
      doc.text(macroText, 58, y + 9, { width: pageWidth - 16, align: 'center' });
      y += 40;

      // Meals
      if (nutrition.meals && nutrition.meals.length > 0) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor(BRAND_BLACK)
          .text('Daily Meal Plan', 50, y);
        y += 20;

        for (const meal of nutrition.meals) {
          if (y > doc.page.height - 80) {
            doc.addPage();
            y = 50;
          }

          doc.fontSize(9).font('Helvetica-Bold').fillColor(BRAND_GOLD)
            .text(`${meal.time} — ${meal.meal}`, 58, y);
          doc.fontSize(9).font('Helvetica').fillColor(BRAND_BLACK)
            .text(`${meal.description} (${meal.calories} kcal)`, 58, y + 14, { width: pageWidth - 16 });
          y += 34;
        }
      }

      // Hydration & supplements
      y += 6;
      if (nutrition.hydration) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(BRAND_BLACK)
          .text('Hydration: ', 58, y, { continued: true });
        doc.font('Helvetica').text(nutrition.hydration);
        y += 16;
      }

      if (nutrition.supplements && nutrition.supplements.length > 0) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(BRAND_BLACK)
          .text('Supplements: ', 58, y, { continued: true });
        doc.font('Helvetica').text(nutrition.supplements.join(', '));
        y += 16;
      }
    }

    // --- Coach Notes ---
    if (programData.coach_notes) {
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = 50;
      }

      y += 10;
      doc.fontSize(16).font('Helvetica-Bold').fillColor(BRAND_GOLD)
        .text('COACH NOTES', 50, y);
      y += 26;

      doc.rect(50, y, pageWidth, 40).fill(LIGHT_GRAY);
      doc.fontSize(10).font('Helvetica').fillColor(BRAND_BLACK)
        .text(programData.coach_notes, 58, y + 10, { width: pageWidth - 16 });
      y += 50;
    }

    // --- Footer on every page ---
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).font('Helvetica').fillColor('#999999')
        .text(
          `fitnessbymaddy.com | Confidential - Prepared for ${client.name}`,
          50,
          doc.page.height - 40,
          { width: pageWidth, align: 'center' }
        );
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');
  if (token !== process.env.INTERNAL_API_KEY && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    // --- 1. Fetch client data ---
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // --- 2. Fetch last 2 checkins ---
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // --- 3. Fetch lead data for intake details ---
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', client.phone)
      .maybeSingle();

    // --- 4. Build Claude prompt ---
    const checkinSummary = (checkins && checkins.length > 0)
      ? checkins.map((c) =>
        `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10, Issues: ${c.issues || 'none'}`
      ).join('\n')
      : 'No previous check-in data available (first week).';

    const startDate = new Date(client.program_started_at);
    const endDate = new Date(client.program_ends_at);
    const totalWeeks = Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

    const intakeInfo = lead?.first_msg
      ? `\nIntake Form Details:\n${lead.first_msg}`
      : '';

    const prompt = `You are a certified fitness program architect for FitnessByMaddy.
Design Week ${week_no} of a ${client.program || 'general fitness'} program.

Client Profile:
- Name: ${client.name}
- Program: ${client.program || 'general fitness'}
- Week: ${week_no} of ${totalWeeks}
${intakeInfo}

Recent Check-in Data:
${checkinSummary}

Generate a complete weekly program as JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 65,
    "meals": [
      {"time": "7:00 AM", "meal": "Breakfast", "description": "...", "calories": 450}
    ],
    "hydration": "3-4L water daily",
    "supplements": ["..."]
  },
  "coach_notes": "One-liner motivation/context for the week"
}

RULES:
- Never recommend extreme calorie deficits below 1200 cal
- Never recommend banned substances or steroids
- Never promise specific weight loss timelines
- Adjust based on previous check-in compliance and energy levels
- If compliance was low, simplify the plan slightly
- If energy was low, reduce volume but maintain intensity

Respond with ONLY the JSON object, no markdown fences or extra text.`;

    // --- 5. Call Claude API ---
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Extract JSON from response (handle potential markdown fences)
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program from AI response' });
    }

    // --- 6. Safety checks ---
    const bannedKeyword = containsBannedContent(programData);
    if (bannedKeyword) {
      // Create escalation
      await supabase.from('escalations').insert({
        source_type: 'program',
        source_id: client_id,
        phone: client.phone,
        reason: `Banned content detected: ${bannedKeyword}`,
        details: JSON.stringify(programData),
      });

      console.error(`Safety check failed for client ${client_id}: ${bannedKeyword}`);
      return res.status(422).json({
        error: 'Program failed safety review',
        reason: `Banned content detected: ${bannedKeyword}`,
      });
    }

    const dailyCals = programData.nutrition_plan?.daily_calories;
    if (dailyCals && dailyCals < 1200) {
      await supabase.from('escalations').insert({
        source_type: 'program',
        source_id: client_id,
        phone: client.phone,
        reason: `Dangerously low calories: ${dailyCals}`,
        details: JSON.stringify(programData),
      });

      console.error(`Safety check failed for client ${client_id}: calories ${dailyCals} < 1200`);
      return res.status(422).json({
        error: 'Program failed safety review',
        reason: `Daily calories ${dailyCals} below minimum 1200`,
      });
    }

    // --- 7. Generate PDF ---
    const pdfBuffer = await generatePDF(programData, client, week_no);

    // --- 8. Upload to Supabase Storage ---
    // Ensure bucket exists
    const { error: bucketErr } = await supabase.storage.createBucket('programs', {
      public: true,
    });
    if (bucketErr && !bucketErr.message.includes('already exists')) {
      console.error('Bucket creation error:', bucketErr.message);
    }

    const storagePath = `clients/${client_id}/week_${week_no}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: publicUrlData } = supabase.storage
      .from('programs')
      .getPublicUrl(storagePath);

    const pdfUrl = publicUrlData.publicUrl;

    // --- 9. Insert program record ---
    const { data: program, error: insertErr } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_notes,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save program record' });
    }

    // --- 10. Send WhatsApp ---
    const { success: whatsappSent } = await sendTemplate(client.phone, 'weekly_program', [
      client.name,
      String(week_no),
      programData.coach_notes || '',
      pdfUrl,
    ]);

    // --- 11. Update whatsapp_sent_at ---
    if (whatsappSent) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({
      success: true,
      pdf_url: pdfUrl,
      program_id: program.id,
    });
  } catch (err) {
    console.error('generate-program error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
