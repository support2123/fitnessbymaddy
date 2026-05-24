const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, sendEscalation } = require('./_lib/whatsapp');
const { maskPhone, isHinglish } = require('./_lib/helpers');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Fetch client data
    const { data: client } = await supabase
      .from('clients')
      .select('*, leads!inner(market, name)')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Fetch last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Generate program via Claude API
    const anthropic = new Anthropic();
    const clientName = client.name || client.leads?.name || 'Client';
    const market = client.leads?.market || 'GLOBAL';

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy. Generate a week's workout and nutrition plan.

RULES:
- Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or unproven supplements
- Never set unrealistic timelines (more than 1kg/week fat loss)
- Adjust based on compliance scores and reported issues
- Be specific: exact exercises, sets, reps, rest periods
- Nutrition: exact macros, meal timing, sample meals

Output valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [{"name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "..."}] },
      ...
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." },
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fats_g": 60,
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "options": ["..."] },
      ...
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": "..."
  },
  "weekly_note": "Short motivational/context note for the client"
}`;

    const checkinContext = checkins && checkins.length > 0
      ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')
      : 'No previous check-ins available (Week 1).';

    const userPrompt = `Generate Week ${week_no} program for:
Client: ${clientName}
Program: ${client.program}
Market: ${market}

Recent check-ins:
${checkinContext}

Create a progressive, personalized plan for this week. If this is week 1, start with a foundation phase. If later weeks, progress based on compliance and energy levels.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const aiText = response.content[0].text;
    let programData;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program data' });
    }

    // Safety check
    if (programData.nutrition_plan?.calories < 1200) {
      await sendEscalation(`Program for ${maskPhone(client.phone)} Week ${week_no} has calories below 1200. Halted for review.`);
      return res.status(400).json({ error: 'Program flagged for safety review' });
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(programData, clientName, week_no, client.program);

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Save to programs table (audit trail)
    await supabase.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_note || null
    }, { onConflict: 'client_id,week_no' });

    // Send via WhatsApp
    const weeklyNote = programData.weekly_note || `Your Week ${week_no} program is ready!`;
    const msg = isHinglish(market)
      ? `Week ${week_no} program ready hai! 💪\n\n${weeklyNote}\n\nPDF: ${pdfUrl}`
      : `Your Week ${week_no} program is ready! 💪\n\n${weeklyNote}\n\nPDF: ${pdfUrl}`;

    const sendResult = await sendWhatsApp({ phone: client.phone, body: msg, templateName: 'weekly_program' });

    if (sendResult.success) {
      await supabase.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', parseInt(week_no));
    }

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function generatePDF(programData, clientName, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program — ${clientName}`, 50, 75, { align: 'center' });

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    // Workout Plan
    doc.fontSize(20).fill('#B8965A').text('WORKOUT PLAN', 50, 150);
    doc.moveTo(50, 175).lineTo(545, 175).stroke('#E8E3DC');

    let y = 190;
    const wp = programData.workout_plan;
    if (wp?.days) {
      for (const day of wp.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(14).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50, y);
        y += 22;
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#6B6B6B')
              .text(`→ ${ex.name}: ${ex.sets} sets x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`, 65, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    if (wp?.cardio) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 10;
      doc.fontSize(12).fill('#B8965A').text('Cardio', 50, y);
      y += 18;
      doc.fontSize(10).fill('#6B6B6B')
        .text(`${wp.cardio.type} — ${wp.cardio.frequency}, ${wp.cardio.duration}`, 65, y);
      y += 24;
    }

    // Nutrition Plan
    doc.addPage();
    doc.fontSize(20).fill('#B8965A').text('NUTRITION PLAN', 50, 50);
    doc.moveTo(50, 75).lineTo(545, 75).stroke('#E8E3DC');

    const np = programData.nutrition_plan;
    y = 90;
    if (np) {
      doc.fontSize(12).fill('#2C2C2C')
        .text(`Daily Target: ${np.calories} kcal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fats: ${np.fats_g}g`, 50, y);
      y += 30;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fontSize(12).fill('#2C2C2C').text(`${meal.meal} (${meal.time})`, 50, y);
          y += 18;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`→ ${opt}`, 65, y);
              y += 14;
            }
          }
          y += 8;
        }
      }

      if (np.supplements?.length > 0) {
        y += 10;
        doc.fontSize(12).fill('#B8965A').text('Supplements', 50, y);
        y += 18;
        for (const sup of np.supplements) {
          doc.fontSize(10).fill('#6B6B6B').text(`→ ${sup}`, 65, y);
          y += 14;
        }
      }

      if (np.hydration) {
        y += 10;
        doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${np.hydration}`, 50, y);
      }
    }

    // Footer
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#C8B89A')
        .text('FitnessByMaddy.com | Confidential — Do not share', 50, doc.page.height - 40, { align: 'center' });
    }

    doc.end();
  });
}
