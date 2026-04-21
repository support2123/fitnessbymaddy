const { getSupabase } = require('./lib/supabase');
const { sendText, notifyMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SYSTEM_PROMPT = `You are a world-class fitness program architect working for Maddy, a NASM-certified personal trainer with 10+ years of experience. Your job is to create weekly customized workout and nutrition plans for clients based on their profile and progress data.

RULES:
- Never recommend extreme calorie cuts (minimum 1200 kcal for women, 1500 kcal for men)
- Never recommend banned or unregulated supplements
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Adjust intensity based on compliance and energy scores
- If client reports pain or medical issues, flag for human review instead of programming around it
- Be evidence-based: progressive overload, adequate protein (1.6-2.2g/kg), proper recovery

OUTPUT FORMAT: Return valid JSON only, no markdown, no explanation. Structure:
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
    "rest_days": ["Wednesday", "Sunday"],
    "notes": "Focus on progressive overload this week"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 73,
    "meals": [
      { "meal": "Breakfast", "options": ["4 egg whites + 2 whole eggs + toast", "Oats with protein powder + banana"] }
    ],
    "hydration": "3-4 litres daily",
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D3"],
    "notes": "Increase protein slightly due to higher training volume"
  },
  "coach_note": "Great progress last week! Keep pushing on compound lifts.",
  "flag_for_review": false
}`;

async function generatePDF(client, weekNo, workout, nutrition, coachNote) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 100).fill('#2C2C2C');
    doc.fillColor('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 40, 30, { align: 'left' });
    doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`${client.name || 'Client'} | Week ${weekNo}`, 40, 65, { align: 'left' });

    let y = 120;

    if (coachNote) {
      doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold').text("COACH'S NOTE", 40, y);
      y += 20;
      doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica').text(coachNote, 40, y, { width: 515 });
      y += doc.heightOfString(coachNote, { width: 515 }) + 20;
    }

    doc.fillColor('#B8965A').fontSize(16).font('Helvetica-Bold').text('WORKOUT PLAN', 40, y);
    y += 25;

    if (workout?.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 40; }
        doc.fillColor('#2C2C2C').fontSize(12).font('Helvetica-Bold').text(`${day.day} — ${day.focus}`, 40, y);
        y += 18;

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fillColor('#6B6B6B').fontSize(9).font('Helvetica')
              .text(`${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 55, y, { width: 500 });
            y += 14;
          }
        }
        if (day.cardio) {
          doc.fillColor('#B8965A').fontSize(9).font('Helvetica').text(`Cardio: ${day.cardio}`, 55, y);
          y += 14;
        }
        y += 10;
      }
    }

    if (y > 600) { doc.addPage(); y = 40; }

    y += 10;
    doc.fillColor('#B8965A').fontSize(16).font('Helvetica-Bold').text('NUTRITION PLAN', 40, y);
    y += 25;

    if (nutrition) {
      doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica-Bold')
        .text(`Daily Targets: ${nutrition.calories} kcal | P: ${nutrition.protein_g}g | C: ${nutrition.carbs_g}g | F: ${nutrition.fat_g}g`, 40, y);
      y += 22;

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica-Bold').text(meal.meal, 55, y);
          y += 15;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fillColor('#6B6B6B').fontSize(9).font('Helvetica').text(`• ${opt}`, 65, y, { width: 490 });
              y += 13;
            }
          }
          y += 5;
        }
      }

      if (nutrition.supplements?.length) {
        y += 5;
        doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica-Bold').text('Supplements:', 55, y);
        y += 15;
        doc.fillColor('#6B6B6B').fontSize(9).font('Helvetica')
          .text(nutrition.supplements.join(' | '), 65, y, { width: 490 });
        y += 20;
      }

      if (nutrition.hydration) {
        doc.fillColor('#6B6B6B').fontSize(9).font('Helvetica').text(`Hydration: ${nutrition.hydration}`, 55, y);
      }
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intake_submissions')
      .select('data')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const userPrompt = JSON.stringify({
      client: {
        name: client.name,
        program: client.program,
        week: week_no,
        started_at: client.program_started_at
      },
      intake: intake?.data || {},
      recent_checkins: recentCheckins || [],
      last_program: lastProgram || null
    });

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Generate Week ${week_no} program for this client:\n${userPrompt}` }]
    });

    const responseText = completion.content[0]?.text || '';
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Claude returned non-JSON response');
      }
    }

    if (parsed.flag_for_review) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${maskPhone(client.phone)} (${client.name})\nWeek: ${week_no}\nReason: AI flagged for human review`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: `FLAGGED: ${parsed.coach_note || 'Needs review'}`
      });
      return res.status(200).json({ success: true, status: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(
      client, week_no,
      parsed.workout_plan, parsed.nutrition_plan, parsed.coach_note
    );

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) console.error('PDF upload error:', uploadErr.message);

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: programRecord } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null
    }).select().single();

    try {
      const note = parsed.coach_note
        ? `Week ${week_no} program ready! ${parsed.coach_note}`
        : `Your Week ${week_no} program is ready! Check it out and let us know if you have questions.`;
      await sendText(client.phone, note);
      if (programRecord) {
        await db.from('programs').update({ whatsapp_sent_at: new Date().toISOString() }).eq('id', programRecord.id);
      }
    } catch (waErr) {
      console.error('WA send failed:', waErr.message);
    }

    return res.status(200).json({ success: true, program_id: programRecord?.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};
