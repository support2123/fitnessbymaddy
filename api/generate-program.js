const { PassThrough } = require('stream');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getClient } = require('./_lib/supabase');
const { sendText, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, jsonResponse } = require('./_lib/helpers');

/* ── Brand colours ── */

const GOLD = [184, 150, 90]; // #B8965A
const DARK = [30, 30, 30];

/* ── Claude system prompt ── */

const SYSTEM_PROMPT = `You are a certified fitness program architect for FitnessByMaddy. Design a weekly training and nutrition plan based on client data. Be evidence-based, safe, and specific. Never recommend extreme calorie deficits (<1200kcal for women, <1500kcal for men), banned substances, or unrealistic timelines. Output ONLY valid JSON.`;

/* ── PDF generation ── */

function generatePDF({ client, weekNo, workoutPlan, nutritionPlan, weeklyNote }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    doc.pipe(stream);

    const pageWidth = doc.page.width - 100; // margins

    /* ── Header ── */
    doc
      .font('Helvetica-Bold')
      .fontSize(24)
      .fillColor(DARK)
      .text('FITNESS BY MADDY', { align: 'center' });

    doc
      .font('Helvetica')
      .fontSize(14)
      .fillColor(DARK)
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, { align: 'center' });

    doc.moveDown(0.5);

    /* ── Gold accent line ── */
    const lineY = doc.y;
    doc
      .moveTo(50, lineY)
      .lineTo(50 + pageWidth, lineY)
      .strokeColor(GOLD)
      .lineWidth(2)
      .stroke();

    doc.moveDown(1);

    /* ── Weekly note ── */
    if (weeklyNote) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .fillColor(DARK)
        .text(weeklyNote, { align: 'center' });
      doc.moveDown(1);
    }

    /* ── Workout section ── */
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(GOLD)
      .text('WORKOUT PLAN');
    doc.moveDown(0.5);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        /* Check if we need a new page */
        if (doc.y > doc.page.height - 180) {
          doc.addPage();
        }

        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .fillColor(DARK)
          .text(`${day.day} — ${day.focus || ''}`);
        doc.moveDown(0.3);

        if (day.exercises && day.exercises.length > 0) {
          /* Table header */
          doc
            .font('Helvetica-Bold')
            .fontSize(9)
            .fillColor(GOLD);

          const colX = [50, 200, 250, 300, 350];
          const colLabels = ['Exercise', 'Sets', 'Reps', 'Rest', 'Notes'];
          colLabels.forEach((label, i) => {
            doc.text(label, colX[i], doc.y, { width: colX[i + 1] ? colX[i + 1] - colX[i] : 195, continued: i < colLabels.length - 1 });
          });
          doc.moveDown(0.3);

          /* Table rows */
          doc.font('Helvetica').fontSize(9).fillColor(DARK);

          for (const ex of day.exercises) {
            if (doc.y > doc.page.height - 80) {
              doc.addPage();
            }

            const rowY = doc.y;
            doc.text(ex.name || '', colX[0], rowY, { width: 145 });
            doc.text(String(ex.sets || ''), colX[1], rowY, { width: 45 });
            doc.text(String(ex.reps || ''), colX[2], rowY, { width: 45 });
            doc.text(String(ex.rest || ''), colX[3], rowY, { width: 45 });
            doc.text(String(ex.notes || ''), colX[4], rowY, { width: 195 });
            doc.moveDown(0.2);
          }
        }

        doc.moveDown(0.5);
      }
    }

    /* ── Nutrition section ── */
    if (doc.y > doc.page.height - 200) {
      doc.addPage();
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(GOLD)
      .text('NUTRITION PLAN');
    doc.moveDown(0.5);

    if (nutritionPlan) {
      /* Macros summary */
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(DARK)
        .text(
          `Daily Targets:  ${nutritionPlan.calories || '—'} kcal  |  ` +
          `Protein: ${nutritionPlan.protein_g || '—'}g  |  ` +
          `Carbs: ${nutritionPlan.carbs_g || '—'}g  |  ` +
          `Fats: ${nutritionPlan.fats_g || '—'}g`
        );
      doc.moveDown(0.5);

      /* Meals */
      if (nutritionPlan.meals && nutritionPlan.meals.length > 0) {
        for (const meal of nutritionPlan.meals) {
          if (doc.y > doc.page.height - 100) {
            doc.addPage();
          }

          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(DARK)
            .text(meal.meal || 'Meal');

          doc.font('Helvetica').fontSize(9);

          if (meal.options && meal.options.length > 0) {
            for (const opt of meal.options) {
              doc.text(`  •  ${opt}`);
            }
          }

          doc.moveDown(0.3);
        }
      }
    }

    /* ── Footer ── */
    doc.moveDown(2);

    const footerY = doc.page.height - 60;
    doc
      .moveTo(50, footerY - 10)
      .lineTo(50 + pageWidth, footerY - 10)
      .strokeColor(GOLD)
      .lineWidth(1)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(DARK)
      .text(
        `Generated for ${client.name || 'Client'} | fitnessbymaddy.com`,
        50,
        footerY,
        { align: 'center', width: pageWidth }
      );

    doc.end();
  });
}

/* ── Safety checks ── */

function checkSafety(nutritionPlan, workoutPlan, client) {
  const issues = [];

  /* Calorie floor — default to female thresholds unless client data says otherwise */
  const calorieFloor = 1200;
  if (nutritionPlan.calories && nutritionPlan.calories < calorieFloor) {
    issues.push(`Calories too low: ${nutritionPlan.calories} kcal (minimum ${calorieFloor})`);
  }

  /* Injury-exercise cross-check */
  const injuries = (client.injuries || '').toLowerCase();
  if (injuries && workoutPlan && workoutPlan.days) {
    const dangerousMap = {
      'knee': ['jump squat', 'box jump', 'lunge jump', 'deep squat', 'pistol squat'],
      'back': ['deadlift', 'good morning', 'barbell row', 'snatch', 'clean and jerk'],
      'shoulder': ['overhead press', 'behind the neck', 'upright row', 'kipping'],
      'wrist': ['handstand', 'planche', 'heavy curl'],
      'ankle': ['box jump', 'jump rope', 'sprints'],
      'neck': ['behind the neck', 'headstand']
    };

    for (const [injuryKey, dangerousExercises] of Object.entries(dangerousMap)) {
      if (injuries.includes(injuryKey)) {
        for (const day of workoutPlan.days) {
          for (const ex of (day.exercises || [])) {
            const exName = (ex.name || '').toLowerCase();
            if (dangerousExercises.some(d => exName.includes(d))) {
              issues.push(`Exercise "${ex.name}" may be unsafe with ${injuryKey} injury`);
            }
          }
        }
      }
    }
  }

  return issues;
}

/* ── Handler ── */

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return jsonResponse(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  let clientPhone;

  try {
    const { client_id, week_no } = req.body || {};

    if (!client_id || !week_no) {
      return jsonResponse(res, 400, { error: 'client_id and week_no are required' });
    }

    const db = getClient();

    /* ── 1. Fetch client ── */
    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return jsonResponse(res, 400, { error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return jsonResponse(res, 400, { error: 'Client is not active' });
    }

    clientPhone = client.phone;

    /* ── 2. Fetch last 2 check-ins ── */
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    /* ── 3. Build Claude prompt ── */
    const checkinSummary = (checkins && checkins.length > 0)
      ? checkins.map(c => ({
          week: c.week_no,
          weight: c.weight,
          waist: c.waist,
          compliance: c.compliance,
          energy: c.energy,
          issues: c.issues
        }))
      : 'No previous check-ins available.';

    const userPrompt = `
Client Profile:
- Name: ${client.name || 'N/A'}
- Program: ${client.program || 'N/A'}
- Age: ${client.age || 'N/A'}
- Goal: ${client.goal || 'N/A'}
- Injuries: ${client.injuries || 'None'}
- Dietary Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

Last Check-in Data:
${typeof checkinSummary === 'string' ? checkinSummary : JSON.stringify(checkinSummary, null, 2)}

Week Number: ${week_no}

Provide the program in this exact JSON format:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body",
        "exercises": [
          { "name": "", "sets": 0, "reps": "", "rest": "", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": [""] }
    ]
  },
  "weekly_note": ""
}`.trim();

    /* ── 4. Call Claude API ── */
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    /* ── 5. Parse response ── */
    let rawText = aiResponse.content[0].text;

    // Strip markdown code fences if present
    rawText = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('[generate-program] Failed to parse Claude response:', parseErr.message, maskPhone(clientPhone));
      return jsonResponse(res, 500, { error: 'Failed to parse AI response' });
    }

    if (!parsed.workout_plan || !parsed.nutrition_plan) {
      console.error('[generate-program] Missing workout_plan or nutrition_plan keys', maskPhone(clientPhone));
      return jsonResponse(res, 500, { error: 'Invalid AI response structure' });
    }

    const { workout_plan, nutrition_plan, weekly_note } = parsed;

    /* ── 6. Safety check ── */
    const safetyIssues = checkSafety(nutrition_plan, workout_plan, client);

    if (safetyIssues.length > 0) {
      /* Flag for review — do NOT send to client */
      const { data: flaggedRow } = await db
        .from('programs')
        .insert({
          client_id,
          week_no,
          generated_at: new Date().toISOString(),
          workout_plan,
          nutrition_plan,
          notes: 'FLAGGED_FOR_REVIEW'
        })
        .select('id')
        .single();

      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client.name || 'Unknown'} (${maskPhone(clientPhone)})\n` +
        `Week: ${week_no}\n` +
        `Issues:\n${safetyIssues.map(i => `  • ${i}`).join('\n')}`
      );

      console.log('[generate-program] Flagged for review:', flaggedRow?.id, maskPhone(clientPhone));

      return jsonResponse(res, 200, { ok: true, flagged: true });
    }

    /* ── 7. Generate PDF ── */
    const pdfBuffer = await generatePDF({
      client,
      weekNo: week_no,
      workoutPlan: workout_plan,
      nutritionPlan: nutrition_plan,
      weeklyNote: weekly_note
    });

    /* ── 8. Upload PDF to Supabase Storage ── */
    const storagePath = `${client_id}/week_${week_no}.pdf`;

    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('[generate-program] PDF upload failed:', uploadErr.message, maskPhone(clientPhone));
      return jsonResponse(res, 500, { error: 'Failed to upload PDF' });
    }

    /* ── 9. Get public URL ── */
    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData.publicUrl;

    /* ── 10. Insert programs row ── */
    const { data: programRow, error: insertErr } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan,
        nutrition_plan,
        notes: weekly_note || null
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[generate-program] Insert failed:', insertErr.message, maskPhone(clientPhone));
      return jsonResponse(res, 500, { error: 'Failed to save program' });
    }

    const programId = programRow.id;

    /* ── 11. Send WhatsApp ── */
    await sendText(
      client.phone,
      `Your Week ${week_no} program is ready! 📋\n\n${weekly_note || 'New week, new gains!'}\n\nDownload: ${pdfUrl}`
    );

    /* ── 12. Mark WhatsApp sent ── */
    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', programId);

    console.log('[generate-program] Sent week', week_no, 'to', maskPhone(clientPhone), 'program_id:', programId);

    return jsonResponse(res, 200, { ok: true, program_id: programId });
  } catch (err) {
    console.error(`[generate-program] Error for ${maskPhone(clientPhone || '')}: ${err.message}`);

    try {
      await notifyMaddy('Program generation error', `${maskPhone(clientPhone || 'unknown')}: ${err.message}`);
    } catch (_) { /* swallow */ }

    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
};
