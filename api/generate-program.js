const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic();

    const systemPrompt = `You are a NASM-certified program architect for Fitness by Maddy, an elite online coaching business. You design weekly workout and nutrition plans that are science-backed, safe, and progressive.

RULES:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 kcal for men)
- Never recommend banned or dangerous supplements
- Never promise unrealistic timelines (e.g., "lose 10kg in 2 weeks")
- Always include rest days
- Progressive overload must be gradual
- Consider client injuries and limitations
- Output valid JSON only`;

    const userPrompt = `Create Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Flexible'}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : 'No check-ins yet (Week 1)'}

PREVIOUS PROGRAM:
${prevProgram ? JSON.stringify(prevProgram, null, 2) : 'None (first week)'}

Return JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "cardio": { "type": "LISS", "frequency": "3x/week", "duration": "25min" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meal_timing": ["7am Breakfast", "12pm Lunch", "4pm Snack", "7pm Dinner"],
    "notes": "Focus on whole foods, adequate hydration"
  },
  "context_note": "One line summary of this week's focus for the WhatsApp message"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;
    let programData;

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Invalid program output from AI' });
    }

    if (isSafeProgram(programData) === false) {
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'FLAGGED FOR REVIEW — potential safety concern'
      });

      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy({
        reason: 'Program flagged for safety review',
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program auto-flagged. Calories: ${programData.nutrition_plan?.calories}`
      });

      return res.status(200).json({ status: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const fileName = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(fileName);

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || fileName,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.context_note || ''
    });

    const contextNote = programData.context_note || `Week ${week_no} program is ready!`;
    await sendWhatsApp({
      phone: client.phone,
      body: `${contextNote}\n\nYour Week ${week_no} program PDF is ready. Check your client portal or download here.`
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({
      success: true,
      program_week: week_no,
      pdf_url: publicUrl?.publicUrl
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function isSafeProgram(data) {
  const cal = data?.nutrition_plan?.calories;
  if (cal && cal < 1200) return false;
  if (cal && cal > 5000) return false;

  const notes = JSON.stringify(data).toLowerCase();
  const banned = ['dnp', 'clenbuterol', 'ephedra', 'sarm', 'anabolic steroid'];
  if (banned.some(b => notes.includes(b))) return false;

  return true;
}

async function generatePDF(client, weekNo, data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');

    doc.font('Helvetica-Bold')
      .fontSize(28)
      .fillColor('#D4AF7A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });

    doc.fontSize(14)
      .fillColor('#ffffff')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });

    doc.fillColor('#888888')
      .fontSize(10)
      .text(`${client.name || 'Client'} | ${client.program?.toUpperCase().replace('_', ' ')}`, 50, 95, { align: 'center' });

    let y = 140;

    doc.fillColor('#1a1a1a')
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('WORKOUT PLAN', 50, y);

    y += 30;

    if (data.workout_plan?.days) {
      for (const day of data.workout_plan.days) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }

        doc.rect(50, y, doc.page.width - 100, 24).fill('#2C2C2C');
        doc.fillColor('#D4AF7A')
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(`${day.day.toUpperCase()} — ${day.focus}`, 60, y + 6);

        y += 30;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) {
              doc.addPage();
              y = 50;
            }

            doc.fillColor('#333333')
              .font('Helvetica')
              .fontSize(10)
              .text(`${ex.name}`, 60, y)
              .text(`${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 280, y);

            if (ex.notes) {
              doc.fillColor('#888888')
                .fontSize(8)
                .text(ex.notes, 60, y + 12);
              y += 24;
            } else {
              y += 16;
            }
          }
        }

        y += 10;
      }
    }

    if (data.workout_plan?.cardio) {
      y += 10;
      doc.fillColor('#1a1a1a')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(`CARDIO: ${data.workout_plan.cardio.type} — ${data.workout_plan.cardio.frequency}, ${data.workout_plan.cardio.duration}`, 50, y);
      y += 25;
    }

    if (y > 600) {
      doc.addPage();
      y = 50;
    }

    y += 20;
    doc.fillColor('#1a1a1a')
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('NUTRITION PLAN', 50, y);

    y += 30;

    const np = data.nutrition_plan;
    if (np) {
      doc.rect(50, y, doc.page.width - 100, 80).fill('#FAF8F4');

      doc.fillColor('#1a1a1a')
        .font('Helvetica-Bold')
        .fontSize(24)
        .text(`${np.calories}`, 80, y + 10)
        .fontSize(10)
        .text('CALORIES', 80, y + 38);

      doc.fillColor('#D4AF7A')
        .fontSize(16)
        .text(`${np.protein_g}g`, 200, y + 10)
        .fillColor('#888888')
        .fontSize(9)
        .text('PROTEIN', 200, y + 30);

      doc.fillColor('#D4AF7A')
        .fontSize(16)
        .text(`${np.carbs_g}g`, 300, y + 10)
        .fillColor('#888888')
        .fontSize(9)
        .text('CARBS', 300, y + 30);

      doc.fillColor('#D4AF7A')
        .fontSize(16)
        .text(`${np.fats_g}g`, 400, y + 10)
        .fillColor('#888888')
        .fontSize(9)
        .text('FATS', 400, y + 30);

      y += 90;

      if (np.meal_timing) {
        doc.fillColor('#333333')
          .font('Helvetica')
          .fontSize(10);
        for (const meal of np.meal_timing) {
          doc.text(`• ${meal}`, 60, y);
          y += 16;
        }
      }

      if (np.notes) {
        y += 10;
        doc.fillColor('#888888')
          .font('Helvetica')
          .fontSize(9)
          .text(np.notes, 60, y, { width: doc.page.width - 120 });
      }
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fillColor('#cccccc')
        .fontSize(8)
        .text(
          'Fitness by Maddy | fitnessbymaddy.com | This program is personalised — do not share.',
          50, doc.page.height - 40,
          { align: 'center', width: doc.page.width - 100 }
        );
    }

    doc.end();
  });
}
