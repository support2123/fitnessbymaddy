// api/generate-program.js — AI-powered weekly program generation using Claude

const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendText } = require('./_lib/whatsapp');
const { notifyMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/utils');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://fitnessbymaddy.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-internal-key',
};

const anthropic = new Anthropic();

/**
 * Validate generated program for risky content.
 * Returns { safe: boolean, reason: string }
 */
function validateProgramSafety(program) {
  const issues = [];

  // Check for extreme calorie cuts
  if (program.nutrition_plan && program.nutrition_plan.calories) {
    if (program.nutrition_plan.calories < 1000) {
      issues.push(`Dangerously low calories: ${program.nutrition_plan.calories}`);
    }
  }

  // Check for banned substances in notes or plan text
  const fullText = JSON.stringify(program).toLowerCase();
  const bannedTerms = [
    'steroid', 'anabolic', 'sarm', 'clenbuterol', 'dnp',
    'ephedra', 'hgh', 'testosterone injection', 'diuretic',
  ];
  for (const term of bannedTerms) {
    if (fullText.includes(term)) {
      issues.push(`Banned substance reference: "${term}"`);
    }
  }

  // Check for unrealistic promises
  const promiseTerms = ['guaranteed', 'lose 10kg in a week', 'instant results', 'miracle'];
  for (const term of promiseTerms) {
    if (fullText.includes(term)) {
      issues.push(`Unrealistic promise: "${term}"`);
    }
  }

  return {
    safe: issues.length === 0,
    reason: issues.join('; '),
  };
}

/**
 * Generate a branded PDF from the program data.
 * Returns a Buffer containing the PDF.
 *
 * Note: Uses Helvetica-Bold (built-in) for headers.
 * Custom fonts (e.g., Bebas Neue) can be added via doc.registerFont()
 * by placing the .ttf file in the project and calling
 * doc.registerFont('BebasNeue', './fonts/BebasNeue-Regular.ttf')
 */
function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PAGE_WIDTH = doc.page.width;
      const MARGIN = 40;
      const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

      // ── Brand colours ─────────────────────────────────────────────
      const BLACK = '#111111';
      const GOLD = '#C9A84C';
      const WHITE = '#FFFFFF';
      const LIGHT_GREY = '#F5F5F5';

      // ── Header ────────────────────────────────────────────────────
      doc.rect(0, 0, PAGE_WIDTH, 100).fill(BLACK);
      doc.fontSize(28).font('Helvetica-Bold').fillColor(GOLD);
      doc.text('FITNESSBYMADDY', MARGIN, 25, { width: CONTENT_WIDTH, align: 'center' });
      doc.fontSize(14).fillColor(WHITE);
      doc.text(`Week ${weekNo} Program — ${client.name || 'Client'}`, MARGIN, 60, {
        width: CONTENT_WIDTH,
        align: 'center',
      });

      doc.moveDown(2);
      let y = 130;

      // ── Workout Plan ──────────────────────────────────────────────
      doc.fontSize(18).font('Helvetica-Bold').fillColor(BLACK);
      doc.text('WORKOUT PLAN', MARGIN, y);
      y += 30;

      // Gold accent line
      doc.rect(MARGIN, y - 5, 60, 3).fill(GOLD);
      y += 10;

      const workout = program.workout_plan || {};
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

      for (const day of days) {
        const dayPlan = workout[day];
        if (!dayPlan) continue;

        // Check if we need a new page
        if (y > doc.page.height - 120) {
          doc.addPage();
          y = MARGIN;
        }

        // Day header
        doc.rect(MARGIN, y, CONTENT_WIDTH, 22).fill(BLACK);
        doc.fontSize(11).font('Helvetica-Bold').fillColor(GOLD);
        doc.text(day.toUpperCase(), MARGIN + 10, y + 5);
        y += 28;

        // Day content
        doc.font('Helvetica').fontSize(10).fillColor(BLACK);
        if (typeof dayPlan === 'string') {
          doc.text(dayPlan, MARGIN + 10, y, { width: CONTENT_WIDTH - 20 });
          y += doc.heightOfString(dayPlan, { width: CONTENT_WIDTH - 20 }) + 10;
        } else if (dayPlan.exercises && Array.isArray(dayPlan.exercises)) {
          for (const exercise of dayPlan.exercises) {
            const line = typeof exercise === 'string'
              ? exercise
              : `${exercise.name || 'Exercise'} — ${exercise.sets || '?'}x${exercise.reps || '?'} ${exercise.rest ? '(rest: ' + exercise.rest + ')' : ''}`;

            // Alternate row background
            const idx = dayPlan.exercises.indexOf(exercise);
            if (idx % 2 === 0) {
              doc.rect(MARGIN, y - 2, CONTENT_WIDTH, 16).fill(LIGHT_GREY);
            }
            doc.fillColor(BLACK);
            doc.text(`  ${line}`, MARGIN + 10, y, { width: CONTENT_WIDTH - 20 });
            y += 16;
          }
          if (dayPlan.notes) {
            doc.fontSize(9).fillColor('#666666');
            doc.text(`Note: ${dayPlan.notes}`, MARGIN + 10, y, { width: CONTENT_WIDTH - 20 });
            y += 14;
          }
        } else {
          // Generic object rendering
          const text = JSON.stringify(dayPlan, null, 2);
          doc.text(text, MARGIN + 10, y, { width: CONTENT_WIDTH - 20 });
          y += doc.heightOfString(text, { width: CONTENT_WIDTH - 20 }) + 10;
        }

        y += 8;
      }

      // ── Nutrition Plan ────────────────────────────────────────────
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = MARGIN;
      }

      y += 10;
      doc.fontSize(18).font('Helvetica-Bold').fillColor(BLACK);
      doc.text('NUTRITION PLAN', MARGIN, y);
      y += 30;
      doc.rect(MARGIN, y - 5, 60, 3).fill(GOLD);
      y += 10;

      const nutrition = program.nutrition_plan || {};

      // Macros summary box
      doc.rect(MARGIN, y, CONTENT_WIDTH, 50).fill(BLACK);
      doc.fontSize(12).font('Helvetica-Bold').fillColor(GOLD);

      const caloriesText = nutrition.calories ? `${nutrition.calories} kcal` : 'See meals';
      const proteinText = nutrition.protein ? `${nutrition.protein}g protein` : '';
      const macroLine = [caloriesText, proteinText].filter(Boolean).join('  |  ');
      doc.text('DAILY TARGETS', MARGIN + 15, y + 8);
      doc.fontSize(11).fillColor(WHITE);
      doc.text(macroLine, MARGIN + 15, y + 28);
      y += 60;

      // Meals
      if (nutrition.meals && Array.isArray(nutrition.meals)) {
        doc.fontSize(10).font('Helvetica').fillColor(BLACK);
        for (const meal of nutrition.meals) {
          if (y > doc.page.height - 80) {
            doc.addPage();
            y = MARGIN;
          }

          const mealText = typeof meal === 'string' ? meal : `${meal.name || 'Meal'}: ${meal.description || meal.items || ''}`;
          doc.font('Helvetica-Bold').text(`  ${mealText}`, MARGIN + 10, y, { width: CONTENT_WIDTH - 20 });
          y += doc.heightOfString(mealText, { width: CONTENT_WIDTH - 20 }) + 8;
          doc.font('Helvetica');
        }
      }

      // ── Notes ─────────────────────────────────────────────────────
      if (program.notes) {
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = MARGIN;
        }
        y += 15;
        doc.fontSize(12).font('Helvetica-Bold').fillColor(BLACK);
        doc.text('COACH NOTES', MARGIN, y);
        y += 20;
        doc.fontSize(10).font('Helvetica').fillColor('#333333');
        doc.text(program.notes, MARGIN + 10, y, { width: CONTENT_WIDTH - 20 });
      }

      // ── Footer ────────────────────────────────────────────────────
      const footerY = doc.page.height - 40;
      doc.fontSize(8).fillColor('#999999').font('Helvetica');
      doc.text(
        'FitnessByMaddy | This program is personalised for you. Do not share. | fitnessbymaddy.com',
        MARGIN,
        footerY,
        { width: CONTENT_WIDTH, align: 'center' }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json');
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── Auth check (optional — allow internal calls) ────────────────
    const internalKey = req.headers['x-internal-key'];
    if (process.env.INTERNAL_API_KEY && internalKey !== process.env.INTERNAL_API_KEY) {
      console.warn('[generate-program] Unauthorized request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { client_id, week_no } = req.body || {};

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }
    if (!week_no && week_no !== 0) {
      return res.status(400).json({ error: 'week_no is required' });
    }

    const weekNum = parseInt(week_no, 10);
    if (isNaN(weekNum) || weekNum < 1) {
      return res.status(400).json({ error: 'week_no must be a positive integer' });
    }

    // ── Fetch client ────────────────────────────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const masked = maskPhone(client.phone);
    console.log(`[generate-program] Generating week ${weekNum} for client ${client.id} (${masked})`);

    // ── Fetch last 2 check-ins ──────────────────────────────────────
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // ── Fetch intake data ───────────────────────────────────────────
    const { data: intakeMessages } = await supabase
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1);

    let intakeData = null;
    if (intakeMessages && intakeMessages.length > 0) {
      try {
        intakeData = JSON.parse(intakeMessages[0].body);
      } catch (_) {
        intakeData = { raw: intakeMessages[0].body };
      }
    }

    // ── Build Claude prompt ─────────────────────────────────────────
    const clientProfile = {
      name: client.name || 'Client',
      program: client.program,
      program_started_at: client.program_started_at,
      current_week: weekNum,
      intake: intakeData,
    };

    const checkinSummary = (checkins || []).map((c) => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
    }));

    const userPrompt = `
Client Profile:
${JSON.stringify(clientProfile, null, 2)}

Recent Check-ins (latest first):
${checkinSummary.length > 0 ? JSON.stringify(checkinSummary, null, 2) : 'No check-ins yet (first week).'}

Generate a complete Week ${weekNum} program. Consider the client's progress, any issues reported, and adjust intensity and nutrition accordingly.

Return ONLY valid JSON in this exact structure:
{
  "workout_plan": {
    "monday": { "focus": "string", "exercises": [{ "name": "string", "sets": number, "reps": "string", "rest": "string" }], "notes": "string" },
    "tuesday": { ... },
    "wednesday": { ... },
    "thursday": { ... },
    "friday": { ... },
    "saturday": { ... },
    "sunday": { "focus": "Rest / Active Recovery", "exercises": [], "notes": "string" }
  },
  "nutrition_plan": {
    "calories": number,
    "protein": number,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "string" },
      { "name": "Meal 2 - Lunch", "description": "string" },
      { "name": "Meal 3 - Snack", "description": "string" },
      { "name": "Meal 4 - Dinner", "description": "string" }
    ]
  },
  "notes": "string with overall coaching notes for the week"
}`;

    // ── Call Claude API ─────────────────────────────────────────────
    console.log(`[generate-program] Calling Claude API for client ${client.id}, week ${weekNum}`);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are a certified personal trainer and nutrition coach creating a weekly program for a client. Output valid JSON only. No markdown, no code fences, no explanatory text — just the JSON object.',
      messages: [
        { role: 'user', content: userPrompt },
      ],
    });

    // ── Parse Claude response ───────────────────────────────────────
    let programData;
    const rawContent = response.content[0].text;

    try {
      // Strip any accidental code fences or whitespace
      const cleaned = rawContent.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      programData = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error(`[generate-program] Failed to parse Claude response for ${masked}:`, parseErr.message);
      console.error('[generate-program] Raw response (first 500 chars):', rawContent.slice(0, 500));
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    // ── Safety validation ───────────────────────────────────────────
    const safety = validateProgramSafety(programData);
    if (!safety.safe) {
      console.warn(`[generate-program] RISKY program flagged for ${masked}: ${safety.reason}`);

      await notifyMaddy(
        `Program safety flag (week ${weekNum}): ${safety.reason}`,
        {
          phone: client.phone,
          clientId: client.id,
          messageBody: `Auto-generated program flagged: ${safety.reason}`,
        }
      );

      // Do NOT auto-send — save as draft for manual review
      const { data: program } = await supabase
        .from('programs')
        .insert({
          client_id,
          week_no: weekNum,
          workout_plan: programData.workout_plan || null,
          nutrition_plan: programData.nutrition_plan || null,
          notes: `[FLAGGED FOR REVIEW] ${safety.reason}\n\n${programData.notes || ''}`,
          generated_at: new Date().toISOString(),
          pdf_url: null,
          whatsapp_sent_at: null,
        })
        .select()
        .single();

      return res.status(200).json({
        success: true,
        flagged: true,
        reason: safety.reason,
        program_id: program ? program.id : null,
      });
    }

    // ── Generate PDF ────────────────────────────────────────────────
    console.log(`[generate-program] Generating PDF for ${masked}, week ${weekNum}`);
    const pdfBuffer = await generatePDF(client, weekNum, programData);

    // ── Upload PDF to Supabase Storage ──────────────────────────────
    const storagePath = `clients/${client_id}/week_${weekNum}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error(`[generate-program] PDF upload failed for ${masked}:`, uploadErr.message);
      // Continue without PDF — still save the data
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData ? urlData.publicUrl : null;

    // ── Insert into programs table ──────────────────────────────────
    const { data: program, error: programErr } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: weekNum,
        workout_plan: programData.workout_plan || null,
        nutrition_plan: programData.nutrition_plan || null,
        notes: programData.notes || null,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        whatsapp_sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (programErr) {
      console.error(`[generate-program] Program insert failed for ${masked}:`, programErr.message);
    }

    // ── Send via WhatsApp ───────────────────────────────────────────
    const weekLabel = weekNum === 1 ? 'first' : `Week ${weekNum}`;
    let messageText = `Your ${weekLabel} program is ready! `;

    if (pdfUrl) {
      messageText += `Download your plan here: ${pdfUrl}`;
    } else {
      messageText += 'Your coach will share it with you shortly.';
    }

    if (programData.notes) {
      messageText += `\n\nCoach notes: ${programData.notes.slice(0, 300)}`;
    }

    await sendText(client.phone, messageText);

    console.log(`[generate-program] Program generated and sent for ${masked}, week ${weekNum}`);

    return res.status(200).json({
      success: true,
      program_id: program ? program.id : null,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('[generate-program] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
