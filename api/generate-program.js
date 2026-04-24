const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase, TABLES } = require('./_utils/supabase');
const { sendTemplate } = require('./_utils/whatsapp');
const { isHinglish } = require('./_utils/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from(TABLES.CLIENTS)
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await db
      .from(TABLES.CHECKINS)
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await db.from(TABLES.LEADS).select('intake_data, market').eq('id', client.lead_id).single()
      : { data: null };

    const intake = (lead && lead.intake_data) || {};
    const market = (lead && lead.market) || 'GLOBAL';

    const prompt = buildPrompt(client, checkins || [], intake, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) || rawText.match(/\{[\s\S]*\}/);
    let programData;

    try {
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawText);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    if (programData.flagged || programData.requires_review) {
      const { notifyMaddy } = require('./_utils/escalation');
      await notifyMaddy('Program flagged for review', `Client: ${client.name}\nWeek ${week_no}\nReason: ${programData.flag_reason || 'Auto-flagged'}`);
      return res.status(200).json({ action: 'flagged_for_review', clientId: client_id });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);

    await db.from(TABLES.PROGRAMS).insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: urlData.publicUrl,
      whatsapp_sent_at: null,
      workout_plan: programData.workout_plan || programData.workouts || null,
      nutrition_plan: programData.nutrition_plan || programData.nutrition || null,
      notes: programData.coach_note || null,
    });

    const templateName = isHinglish(market) ? 'weekly_program_hi' : 'weekly_program_en';
    await sendTemplate(client.phone, templateName, [
      client.name || 'Champion',
      `Week ${week_no}`,
      urlData.publicUrl,
    ]);

    await db.from(TABLES.PROGRAMS).update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

    return res.status(200).json({ success: true, pdfUrl: urlData.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  return `You are a NASM-certified fitness program architect for FitnessByMaddy.
Generate a week ${weekNo} program for this client. Return ONLY valid JSON.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Experience: ${intake.experience_level || 'Intermediate'}
- Injuries/limitations: ${intake.injuries || 'None reported'}
- Diet preference: ${intake.diet_pref || 'No preference'}
- Schedule: ${intake.workout_schedule || '5 days/week'}

LAST CHECK-IN (Week ${lastCheckin.week_no || 'N/A'}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}

PREVIOUS CHECK-IN (Week ${prevCheckin.week_no || 'N/A'}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10

RULES:
- Never prescribe extreme calorie deficits below 1200 kcal for women or 1500 for men
- Never recommend banned substances or supplements requiring medical supervision
- Never set unrealistic timelines (max 1kg/week fat loss)
- If client reports pain/injury, flag for review instead of programming around it
- If you detect anything requiring medical clearance, set "flagged": true and "flag_reason"

Return JSON:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]}
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "sample_meals": [{ "meal": "Breakfast", "options": ["..."] }],
    "hydration": "...",
    "supplements": ["..."]
  },
  "coach_note": "Brief personalized note for the client",
  "flagged": false,
  "flag_reason": null
}`;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#D4AF7A').text(client.name || 'Client', 50, 95, { align: 'center' });

    let y = 140;

    if (programData.coach_note) {
      doc.fontSize(11).fill('#6B6B6B').text(programData.coach_note, 50, y, { width: 495 });
      y += doc.heightOfString(programData.coach_note, { width: 495 }) + 20;
    }

    doc.rect(50, y, 495, 2).fill('#B8965A');
    y += 15;

    const workout = programData.workout_plan || programData.workouts;
    if (workout && workout.days) {
      doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).fill('#B8965A').text(day.day.toUpperCase() + (day.focus ? ` — ${day.focus}` : ''), 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            const line = `${ex.name}  •  ${ex.sets} x ${ex.reps}  •  Rest: ${ex.rest || '60s'}`;
            doc.fontSize(10).fill('#2C2C2C').text(line, 70, y);
            y += 16;
            if (ex.notes) {
              doc.fontSize(9).fill('#6B6B6B').text(ex.notes, 85, y);
              y += 14;
            }
          }
        }
        y += 10;
      }

      if (workout.cardio) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(11).fill('#2C2C2C').text(`Cardio: ${workout.cardio}`, 50, y);
        y += 20;
      }
    }

    const nutrition = programData.nutrition_plan || programData.nutrition;
    if (nutrition) {
      if (y > 600) { doc.addPage(); y = 50; }
      doc.rect(50, y, 495, 2).fill('#B8965A');
      y += 15;
      doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50, y);
      y += 30;

      const macros = `Calories: ${nutrition.calories} kcal  |  Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fats: ${nutrition.fats_g}g`;
      doc.fontSize(11).fill('#2C2C2C').text(macros, 50, y);
      y += 25;

      if (nutrition.sample_meals) {
        for (const meal of nutrition.sample_meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill('#B8965A').text(meal.meal, 50, y);
          y += 16;
          const options = Array.isArray(meal.options) ? meal.options : [meal.options];
          for (const opt of options) {
            doc.fontSize(10).fill('#6B6B6B').text(`• ${opt}`, 70, y);
            y += 14;
          }
          y += 6;
        }
      }

      if (nutrition.hydration) {
        doc.fontSize(10).fill('#2C2C2C').text(`Hydration: ${nutrition.hydration}`, 50, y);
        y += 20;
      }
    }

    y = Math.max(y, 750);
    if (y > 780) { doc.addPage(); y = 750; }
    doc.rect(0, y, doc.page.width, 50).fill('#2C2C2C');
    doc.fontSize(8).fill('#B8965A').text('fitnessbymaddy.com  |  @fitnessbymaddy_', 50, y + 18, { align: 'center', width: 495 });

    doc.end();
  });
}
