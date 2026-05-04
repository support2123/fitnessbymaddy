const { supabase } = require('../lib/supabase');
const { sendWhatsAppPdf } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const RISKY_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp|dinitrophenol/i,
  /ephedra/i,
  /steroids?\s*(cycle|stack)/i,
  /lose\s*(10|15|20)\+?\s*kg\s*in\s*(1|2)\s*week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: previousPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const prompt = buildPrompt(client, recentCheckins || [], previousPrograms || [], week_no);

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0].text;

    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(raw)) {
        await supabase.from('escalations').insert({
          phone: client.phone,
          reason: 'Program generation flagged: risky content',
          message_body: raw.substring(0, 500)
        });
        return res.status(200).json({
          message: 'Program flagged for review — risky content detected',
          flagged: true
        });
      }
    }

    let parsed;
    try {
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : raw);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse program JSON from Claude' });
    }

    const pdfBuffer = await generatePdf(client, parsed, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData.publicUrl;

    const { error: progError } = await supabase
      .from('programs')
      .upsert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: parsed.workout_plan || parsed.workout || null,
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition || null,
        notes: parsed.notes || null,
        generated_at: new Date().toISOString()
      }, { onConflict: 'client_id,week_no' });

    if (progError) {
      console.error('Program upsert error:', progError.message);
    }

    await sendWhatsAppPdf({
      phone: client.phone,
      templateName: 'weekly_program',
      pdfUrl,
      params: [client.name || 'there', String(week_no)]
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      message: 'Program generated and sent',
      pdf_url: pdfUrl,
      week_no
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, previousPrograms, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];
  const prevProgram = previousPrograms[0];

  return `You are "Program Architect" for FitnessByMaddy, an elite online coaching brand.

Generate a WEEK ${weekNo} training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Phone market: detected from sign-up

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None reported'}` : 'No check-in data yet.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10` : ''}

${prevProgram ? `PREVIOUS PROGRAM (Week ${prevProgram.week_no}):
- Notes: ${prevProgram.notes || 'None'}` : ''}

RULES:
- Base calories on sensible TDEE estimates, NEVER below 1300 for women or 1600 for men
- No banned substances, no extreme protocols
- Progressive overload where appropriate
- If compliance is low (<6), reduce volume slightly and add motivation note
- If energy is low (<5), add a deload day or reduce intensity

OUTPUT FORMAT — respond with ONLY a JSON object:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_timing": "...",
    "sample_meals": [
      { "meal": "Breakfast", "options": ["..."] },
      ...
    ],
    "hydration": "...",
    "supplements": "..."
  },
  "notes": "One paragraph summary of this week's focus and motivation."
}`;
}

function generatePdf(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, 595.28, 841.89).fill('#1a1a1a');

    doc.fillColor('#B8965A')
      .fontSize(32)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 50, { align: 'center' });

    doc.fillColor('#ffffff')
      .fontSize(20)
      .font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 100, { align: 'center' });

    doc.fillColor('#B8965A')
      .fontSize(12)
      .text(`Prepared for: ${client.name || 'Client'}`, 50, 135, { align: 'center' });

    doc.moveTo(50, 165).lineTo(545, 165).strokeColor('#B8965A').lineWidth(1).stroke();

    let y = 185;

    const workout = programData.workout_plan || programData.workout;
    if (workout && workout.days) {
      doc.fillColor('#B8965A').fontSize(18).font('Helvetica-Bold').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of workout.days) {
        if (y > 750) { doc.addPage(); doc.rect(0, 0, 595.28, 841.89).fill('#1a1a1a'); y = 50; }

        doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold').text(`${day.day} — ${day.focus}`, 50, y);
        y += 22;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 770) { doc.addPage(); doc.rect(0, 0, 595.28, 841.89).fill('#1a1a1a'); y = 50; }
            doc.fillColor('#cccccc').fontSize(10).font('Helvetica')
              .text(`  •  ${ex.name}  —  ${ex.sets}×${ex.reps}  (Rest: ${ex.rest || '60s'})`, 60, y);
            y += 16;
          }
        }
        y += 10;
      }

      if (workout.cardio) {
        if (y > 750) { doc.addPage(); doc.rect(0, 0, 595.28, 841.89).fill('#1a1a1a'); y = 50; }
        doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold').text('Cardio:', 50, y);
        y += 16;
        doc.fillColor('#cccccc').fontSize(10).font('Helvetica').text(workout.cardio, 60, y, { width: 480 });
        y += 30;
      }
    }

    const nutrition = programData.nutrition_plan || programData.nutrition;
    if (nutrition) {
      if (y > 650) { doc.addPage(); doc.rect(0, 0, 595.28, 841.89).fill('#1a1a1a'); y = 50; }

      doc.moveTo(50, y).lineTo(545, y).strokeColor('#B8965A').lineWidth(0.5).stroke();
      y += 20;

      doc.fillColor('#B8965A').fontSize(18).font('Helvetica-Bold').text('NUTRITION PLAN', 50, y);
      y += 30;

      doc.fillColor('#ffffff').fontSize(11).font('Helvetica')
        .text(`Daily Calories: ${nutrition.calories || 'TBD'}  |  Protein: ${nutrition.protein_g || '?'}g  |  Carbs: ${nutrition.carbs_g || '?'}g  |  Fat: ${nutrition.fat_g || '?'}g`, 50, y);
      y += 25;

      if (nutrition.sample_meals) {
        for (const meal of nutrition.sample_meals) {
          if (y > 770) { doc.addPage(); doc.rect(0, 0, 595.28, 841.89).fill('#1a1a1a'); y = 50; }
          doc.fillColor('#B8965A').fontSize(11).font('Helvetica-Bold').text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fillColor('#cccccc').fontSize(10).font('Helvetica').text(`  •  ${opt}`, 60, y, { width: 480 });
              y += 14;
            }
          }
          y += 6;
        }
      }
    }

    if (programData.notes) {
      if (y > 700) { doc.addPage(); doc.rect(0, 0, 595.28, 841.89).fill('#1a1a1a'); y = 50; }
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#B8965A').lineWidth(0.5).stroke();
      y += 20;
      doc.fillColor('#B8965A').fontSize(14).font('Helvetica-Bold').text('COACH NOTES', 50, y);
      y += 22;
      doc.fillColor('#cccccc').fontSize(11).font('Helvetica').text(programData.notes, 50, y, { width: 495 });
    }

    doc.end();
  });
}
