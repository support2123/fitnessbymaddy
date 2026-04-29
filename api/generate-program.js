const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/helpers');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a program architect for FitnessByMaddy, a premium online fitness coaching brand. Generate a weekly training and nutrition plan based on client data. Output valid JSON only — no markdown.

Rules:
- Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements not widely recognized as safe
- Never promise specific weight loss timelines
- Base recommendations on evidence-based exercise science
- Adjust based on check-in compliance and reported issues
- If the client reports pain or injury, flag for human review instead of programming around it`;

    const userPrompt = `Client: ${client.name || 'Unknown'}
Program: ${client.program}
Week: ${week_no}

Recent check-ins: ${JSON.stringify(recentCheckins || [], null, 2)}
Previous program: ${JSON.stringify(prevPrograms?.[0] || {}, null, 2)}

Generate Week ${week_no} program as JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "frequency": "3x/week", "type": "...", "duration": "20-30 min" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "hydration": "3L/day",
    "supplements": ["..."]
  },
  "notes": "Week focus and key coaching points",
  "flag_for_review": false
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let programData;
    try {
      programData = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        programData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse program JSON from Claude response');
      }
    }

    if (programData.flag_for_review) {
      await notifyMaddy(`Program flagged for review — ${maskPhone(client.phone)} Week ${week_no}. Check admin dashboard.`);
      await db.from('escalations').insert({
        phone: client.phone,
        trigger_type: 'program_flagged',
        message_body: `Week ${week_no} program flagged by AI: ${programData.notes || 'No notes'}`
      });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const fileName = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage.from('programs').getPublicUrl(fileName);
    const pdfUrl = urlData?.publicUrl || null;

    await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || {},
      nutrition_plan: programData.nutrition_plan || {},
      notes: programData.notes || null
    });

    if (!programData.flag_for_review) {
      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_program',
        body: `Your Week ${week_no} program is ready! ${programData.notes || 'Let\'s keep pushing!'}\n\nPDF: ${pdfUrl || 'Check your client portal'}`,
        params: [client.name || 'Champion', String(week_no)]
      });

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('client_id', client_id).eq('week_no', parseInt(week_no));
    }

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#D4AF7A').text(client.name || 'Client', 50, 95, { align: 'center' });

    let y = 140;

    if (programData.workout_plan?.days) {
      doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of programData.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.rect(50, y, doc.page.width - 100, 24).fill('#F0EAE0');
        doc.fontSize(12).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 60, y + 6);
        y += 30;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#2C2C2C').text(
              `${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`,
              70, y
            );
            if (ex.notes) {
              doc.fontSize(8).fill('#6B6B6B').text(ex.notes, 70, y + 14);
              y += 12;
            }
            y += 18;
          }
        }
        y += 10;
      }

      if (programData.workout_plan.cardio) {
        if (y > 700) { doc.addPage(); y = 50; }
        const c = programData.workout_plan.cardio;
        doc.fontSize(10).fill('#B8965A').text(
          `Cardio: ${c.frequency} — ${c.type} — ${c.duration}`, 50, y
        );
        y += 30;
      }
    }

    if (programData.nutrition_plan) {
      if (y > 600) { doc.addPage(); y = 50; }

      doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = programData.nutrition_plan;
      doc.fontSize(10).fill('#2C2C2C');
      doc.text(`Calories: ${np.calories || '—'} kcal  |  Protein: ${np.protein_g || '—'}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fat: ${np.fat_g || '—'}g`, 50, y);
      y += 20;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill('#B8965A').text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill('#6B6B6B').text(`• ${opt}`, 65, y);
              y += 14;
            }
          }
          y += 6;
        }
      }

      if (np.hydration) {
        doc.fontSize(10).fill('#2C2C2C').text(`Hydration: ${np.hydration}`, 50, y);
        y += 20;
      }
    }

    if (programData.notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      doc.fontSize(12).fill('#B8965A').text('COACH NOTES', 50, y);
      y += 20;
      doc.fontSize(10).fill('#2C2C2C').text(programData.notes, 50, y, { width: doc.page.width - 100 });
    }

    doc.end();
  });
}
