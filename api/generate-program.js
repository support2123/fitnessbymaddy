const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const RISKY_PATTERNS = [
  /under\s*(800|700|600|500|400)\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sibutramine|eca\s*stack/i,
  /lose\s*(10|15|20)\+?\s*(kg|lbs?)\s*in\s*(1|2)\s*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*, intake:intake_submissions(*)')
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

    const anthropic = new Anthropic();

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Create a weekly training + nutrition plan based on the client data.
Output valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One paragraph summary of focus for this week"
}
Rules:
- Never prescribe fewer than 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Adjust based on compliance score and energy levels from check-ins
- Account for reported injuries or issues
- Be progressive: increase volume/intensity week over week appropriately`;

    const userPrompt = `Client profile:
${JSON.stringify({
  name: client.name,
  program: client.program,
  week: week_no,
  intake: client.intake?.[0] || null,
}, null, 2)}

Recent check-ins:
${JSON.stringify(recentCheckins || [], null, 2)}

Generate the Week ${week_no} program.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].text;
    let programData;

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const fullText = JSON.stringify(programData);
    const isRisky = RISKY_PATTERNS.some(p => p.test(fullText));

    if (isRisky) {
      const { sendWhatsApp: sendWA } = require('./lib/whatsapp');
      await sendWA('+917082478374', 'escalation_alert', [
        'Risky program content flagged',
        client.phone,
        `Week ${week_no} program for ${client.name || 'client'} contains potentially unsafe content`,
      ]);
      return res.status(200).json({ flagged: true, reason: 'Content flagged for review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = await db.storage
      .from('clients')
      .createSignedUrl(filePath, 7 * 24 * 60 * 60);

    const pdfUrl = urlData?.signedUrl || null;

    await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
    }, { onConflict: 'client_id,week_no' });

    if (pdfUrl) {
      await sendWhatsApp(client.phone, 'weekly_program', [
        client.name || 'Champion',
        String(week_no),
        programData.notes || 'New week, new gains!',
      ], pdfUrl);

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('client_id', client_id).eq('week_no', week_no);
    }

    return res.status(200).json({ success: true, week: week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75);
    doc.fontSize(10).fill('#D4AF7A')
      .text(`Program: ${client.program} | Generated: ${new Date().toLocaleDateString()}`, 50, 95);

    doc.moveDown(3);

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const workout = programData.workout_plan;
    if (workout?.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C')
              .text(`  • ${ex.name}: ${ex.sets} x ${ex.reps} (Rest: ${ex.rest})`, 60);
            if (ex.notes) {
              doc.fontSize(9).fill('#6B6B6B').text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);

        if (doc.y > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, 40).fill('#2C2C2C');
          doc.fontSize(10).fill('#B8965A').text('FITNESS BY MADDY', 50, 12);
          doc.moveDown(2);
        }
      }
    }

    if (workout?.cardio) {
      doc.moveDown(0.5);
      doc.fontSize(11).fill('#2C2C2C').text('Cardio:', 50);
      doc.fontSize(10).fill('#6B6B6B')
        .text(`  ${workout.cardio.type} — ${workout.cardio.duration}, ${workout.cardio.frequency}`, 60);
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 40).fill('#2C2C2C');
    doc.fontSize(10).fill('#B8965A').text('FITNESS BY MADDY', 50, 12);
    doc.moveDown(2);

    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      doc.fontSize(12).fill('#2C2C2C')
        .text(`Daily Targets: ${nutrition.calories} kcal | P: ${nutrition.protein_g}g | C: ${nutrition.carbs_g}g | F: ${nutrition.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(11).fill('#B8965A').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`  • ${opt}`, 60);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (nutrition.supplements?.length) {
        doc.moveDown(0.5);
        doc.fontSize(11).fill('#2C2C2C').text('Supplements:', 50);
        for (const sup of nutrition.supplements) {
          doc.fontSize(10).fill('#6B6B6B').text(`  • ${sup}`, 60);
        }
      }

      if (nutrition.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(11).fill('#2C2C2C').text('Hydration:', 50);
        doc.fontSize(10).fill('#6B6B6B').text(`  ${nutrition.hydration}`, 60);
      }
    }

    if (programData.notes) {
      doc.moveDown(1);
      doc.rect(50, doc.y, 495, 60).fill('#FAF8F4');
      doc.fontSize(10).fill('#2C2C2C').text(programData.notes, 60, doc.y + 10, { width: 475 });
    }

    const bottomY = doc.page.height - 40;
    doc.rect(0, bottomY, doc.page.width, 40).fill('#2C2C2C');
    doc.fontSize(8).fill('#6B6B6B')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, bottomY + 14);

    doc.end();
  });
}
