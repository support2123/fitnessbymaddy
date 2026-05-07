const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const supabase = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { isHinglishMarket } = require('./_lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a program architect for FitnessByMaddy, an elite online fitness coaching brand.
Generate a weekly training and nutrition program customized for this client.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "LISS", "duration": "30min", "frequency": "3x/week" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 73,
    "meal_timing": ["7am Breakfast", "10am Snack", "1pm Lunch", "4pm Pre-workout", "7pm Dinner"],
    "notes": "Focus on whole foods, adequate hydration"
  },
  "weekly_focus": "Progressive overload on compound lifts",
  "context_note": "Brief 1-liner for WhatsApp delivery"
}

Rules:
- Never prescribe below 1200 kcal for women or 1500 kcal for men
- Never recommend banned substances or extreme protocols
- Base progressive overload on check-in data
- Adjust for injuries/limitations listed in client profile
- Keep it practical and evidence-based`;

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      age: client.age,
      goal: client.goal,
      injuries: client.injuries,
      diet_pref: client.diet_pref,
      schedule: client.schedule
    };

    const userPrompt = `Client Profile: ${JSON.stringify(clientProfile)}

Recent Check-ins: ${JSON.stringify(recentCheckins || [])}

Generate Week ${week_no} program. Consider compliance scores and energy levels from check-ins to adjust intensity.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse Claude response:', e.message);
      return res.status(500).json({ error: 'Failed to parse program data' });
    }

    const flagged = checkSafetyFlags(JSON.stringify(programData));
    if (flagged) {
      const { escalate } = require('./_lib/escalation');
      await escalate(client.phone, `Program safety flag: ${flagged}`, `Week ${week_no} program flagged`);
      return res.status(200).json({ ok: true, flagged: true, reason: flagged });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: pdfUrlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = pdfUrlData.publicUrl;

    await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_focus
    });

    const market = client.leads?.market || 'GLOBAL';
    const contextNote = programData.context_note || `Week ${week_no} program ready!`;
    const msg = isHinglishMarket(market)
      ? `Week ${week_no} ka program ready hai!\n${contextNote}\n\nPDF: ${pdfUrl}`
      : `Your Week ${week_no} program is ready!\n${contextNote}\n\nPDF: ${pdfUrl}`;

    await sendWhatsApp(client.phone, msg, null, true);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function checkSafetyFlags(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fillColor('#D4AF7A').text(client.name ? client.name.toUpperCase() : 'CLIENT', 50, 95, { align: 'center' });

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    // Workout Plan
    doc.fontSize(18).fillColor('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
    doc.moveDown(0.5);

    if (programData.workout_plan?.days) {
      for (const day of programData.workout_plan.days) {
        if (doc.y > 700) { doc.addPage(); }
        doc.fontSize(13).fillColor('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fillColor('#6B6B6B')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  |  ' + ex.notes : ''}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (programData.workout_plan?.cardio) {
      doc.moveDown(0.5);
      const c = programData.workout_plan.cardio;
      doc.fontSize(11).fillColor('#2C2C2C').text(`Cardio: ${c.type} — ${c.duration}, ${c.frequency}`, 50);
    }

    // Nutrition Plan
    if (doc.y > 600) { doc.addPage(); }
    doc.moveDown(1.5);
    doc.fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
    doc.moveDown(0.5);

    if (programData.nutrition_plan) {
      const np = programData.nutrition_plan;
      doc.fontSize(12).fillColor('#2C2C2C');
      doc.text(`Daily Calories: ${np.calories} kcal`, 50);
      doc.text(`Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (np.meal_timing) {
        doc.fontSize(11).fillColor('#6B6B6B').text('Meal Timing:', 50);
        for (const meal of np.meal_timing) {
          doc.text(`  ${meal}`, 60);
        }
      }

      if (np.notes) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#6B6B6B').text(np.notes, 50);
      }
    }

    // Weekly Focus
    if (programData.weekly_focus) {
      doc.moveDown(1.5);
      doc.fontSize(14).fillColor('#B8965A').text('WEEKLY FOCUS', 50);
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('#2C2C2C').text(programData.weekly_focus, 50);
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#C8B89A').text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}
