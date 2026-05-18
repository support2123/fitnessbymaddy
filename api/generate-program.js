const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendDocument, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*cal/i, /extreme\s*cut/i,
  /clenbuterol/i, /dnp/i, /ephedra/i, /steroid/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i
];

module.exports = async function handler(req, res) {
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
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Create a weekly training and nutrition plan based on the client's profile and recent check-in data.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ], "cardio": "15min incline walk" }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Oats with whey protein and banana", "Egg white omelette with toast"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "weekly_note": "Focus on progressive overload this week..."
}

Rules:
- Never suggest calories below 1200 for women or 1500 for men
- Never recommend banned substances, steroids, or extreme protocols
- Be realistic with timelines
- Consider injuries, diet preferences, and schedule constraints
- For PCOS clients: focus on insulin sensitivity, anti-inflammatory foods
- For 40+ clients: prioritize joint health, recovery, moderate intensity`;

    const userPrompt = `Client Profile:
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
- Goal: ${client.goal || 'general fitness'}
- Age: ${client.age || 'unknown'}
- Injuries: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'no restrictions'}
- Schedule: ${client.schedule || 'flexible'}

Recent Check-ins:
${recentCheckins?.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n') || 'No previous check-ins'}

Generate the Week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(rawText)) {
        await notifyMaddy(
          'Program safety flag',
          `Client: ${maskPhone(client.phone)}\nWeek ${week_no}\nPattern matched: ${pattern}\nPlease review before sending.`
        );
        await supabase.from('programs').insert({
          client_id, week_no,
          workout_plan: null, nutrition_plan: null,
          notes: `FLAGGED: Safety pattern matched — ${pattern}. Awaiting Maddy review.`,
          generated_at: new Date().toISOString()
        });
        return res.json({ ok: false, flagged: true });
      }
    }

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Failed to parse Claude response as JSON');
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const filePath = `${client.folder_url || `clients/${client.id}`}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) throw uploadError;

    const { data: publicUrl } = supabase.storage.from('programs').getPublicUrl(filePath);

    const { error: dbError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl.publicUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.weekly_note || null
    });

    if (dbError) throw dbError;

    const caption = parsed.weekly_note || `Week ${week_no} program ready! Let's go 💪`;
    await sendDocument(client.phone, publicUrl.publicUrl, caption);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ ok: true, pdf_url: publicUrl.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, 595.28, 80).fill('#1a1a1a');
    doc.fontSize(28).fill('#D4AF7A').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { align: 'center' });
    doc.fontSize(10).fill('#888888')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { align: 'center' });

    doc.moveDown(3);
    doc.fontSize(10).fill('#666666').font('Helvetica')
      .text(`Client: ${client.name || 'Client'}  |  Program: ${client.program}  |  Week ${weekNo}`, 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 495.28, 1).fill('#D4AF7A');
    doc.moveDown(1);

    if (plan.workout_plan?.days) {
      doc.fontSize(18).fill('#1a1a1a').font('Helvetica-Bold').text('WORKOUT PLAN');
      doc.moveDown(0.5);

      for (const day of plan.workout_plan.days) {
        if (doc.y > 700) { doc.addPage(); doc.moveDown(1); }

        doc.fontSize(13).fill('#D4AF7A').font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#333333').font('Helvetica')
              .text(`  •  ${ex.name}  —  ${ex.sets} x ${ex.reps}  (Rest: ${ex.rest})${ex.notes ? '  ' + ex.notes : ''}`);
          }
        }
        if (day.cardio) {
          doc.fontSize(10).fill('#666666').font('Helvetica-Oblique')
            .text(`  Cardio: ${day.cardio}`);
        }
        doc.moveDown(0.5);
      }

      if (plan.workout_plan.rest_days?.length) {
        doc.fontSize(10).fill('#888888').font('Helvetica')
          .text(`Rest days: ${plan.workout_plan.rest_days.join(', ')}`);
      }
    }

    doc.moveDown(1);
    if (doc.y > 650) doc.addPage();

    if (plan.nutrition_plan) {
      const np = plan.nutrition_plan;
      doc.fontSize(18).fill('#1a1a1a').font('Helvetica-Bold').text('NUTRITION PLAN');
      doc.moveDown(0.5);

      doc.fontSize(11).fill('#333333').font('Helvetica')
        .text(`Daily targets:  ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(12).fill('#D4AF7A').font('Helvetica-Bold').text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#333333').font('Helvetica').text(`  •  ${opt}`);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.supplements?.length) {
        doc.moveDown(0.3);
        doc.fontSize(11).fill('#1a1a1a').font('Helvetica-Bold').text('Supplements:');
        doc.fontSize(10).fill('#333333').font('Helvetica')
          .text(`  ${np.supplements.join('  |  ')}`);
      }

      if (np.hydration) {
        doc.fontSize(10).fill('#666666').font('Helvetica').text(`  Hydration: ${np.hydration}`);
      }
    }

    if (plan.weekly_note) {
      doc.moveDown(1.5);
      doc.rect(50, doc.y, 495.28, 1).fill('#D4AF7A');
      doc.moveDown(0.5);
      doc.fontSize(11).fill('#1a1a1a').font('Helvetica-Bold').text("COACH'S NOTE");
      doc.fontSize(10).fill('#333333').font('Helvetica-Oblique').text(plan.weekly_note);
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#aaaaaa').font('Helvetica')
      .text('This program is generated by FitnessByMaddy coaching system. For medical concerns, consult your physician.', { align: 'center' });

    doc.end();
  });
}
