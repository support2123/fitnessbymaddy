const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20', 'crash diet',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some((flag) => lower.includes(flag));
}

async function generateWithClaude(clientData, checkins) {
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const prompt = `You are "Program Architect" for FitnessByMaddy, an elite online coaching brand.

Generate a 1-week training + nutrition plan for this client. Output valid JSON only.

CLIENT PROFILE:
- Name: ${clientData.name || 'Client'}
- Program: ${clientData.program}
- Age: ${clientData.age || 'Unknown'}
- Goal: ${clientData.goal || 'General fitness'}
- Injuries/Limitations: ${clientData.injuries || 'None reported'}
- Diet Preference: ${clientData.diet_pref || 'No preference'}
- Schedule: ${clientData.schedule || 'Flexible'}

RECENT CHECK-IN DATA:
${checkins.map((c) => `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'None'}`).join('\n')}

RULES:
- Never prescribe below 1200 kcal for women or 1500 kcal for men
- No banned substances or supplements beyond basic (whey, creatine, multivitamin)
- Realistic weekly fat loss: 0.5-1kg max
- Account for injuries and limitations
- If compliance is low, simplify the plan
- If energy is low, reduce volume and add recovery work

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "frequency": "3x/week", "type": "...", "duration": "..." },
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] },
      ...
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": "..."
  },
  "weekly_focus": "...",
  "motivation_note": "..."
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(programData, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#D4AF7A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program — ${clientName || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(3);

    const wp = programData.workout_plan;
    if (wp && wp.days) {
      doc.fontSize(20).fill('#2C2C2C').text('WORKOUT PLAN', 50);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#D4AF7A');
      doc.moveDown(0.5);

      for (const day of wp.days) {
        if (doc.y > 700) { doc.addPage(); doc.moveDown(1); }

        doc.fontSize(14).fill('#B8965A').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C')
              .text(`• ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 70);
            if (ex.notes) {
              doc.fontSize(9).fill('#6B6B6B').text(`  ${ex.notes}`, 85);
            }
          }
        }
        doc.moveDown(0.5);
      }

      if (wp.cardio) {
        doc.moveDown(0.5);
        doc.fontSize(12).fill('#B8965A').text('Cardio', 50);
        doc.fontSize(10).fill('#2C2C2C')
          .text(`${wp.cardio.frequency} — ${wp.cardio.type} — ${wp.cardio.duration}`, 70);
      }
    }

    doc.addPage();

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(20).fill('#2C2C2C').text('NUTRITION PLAN', 50);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#D4AF7A');
      doc.moveDown(0.5);

      doc.fontSize(12).fill('#2C2C2C')
        .text(`Daily Calories: ${np.calories} kcal`, 50)
        .text(`Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(12).fill('#B8965A').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#2C2C2C').text(`• ${opt}`, 70);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.supplements && np.supplements.length) {
        doc.moveDown(0.5);
        doc.fontSize(12).fill('#B8965A').text('Supplements', 50);
        for (const sup of np.supplements) {
          doc.fontSize(10).fill('#2C2C2C').text(`• ${sup}`, 70);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(12).fill('#B8965A').text('Hydration', 50);
        doc.fontSize(10).fill('#2C2C2C').text(np.hydration, 70);
      }
    }

    if (programData.weekly_focus) {
      doc.moveDown(1);
      doc.fontSize(14).fill('#2C2C2C').text('THIS WEEK\'S FOCUS', 50);
      doc.fontSize(11).fill('#6B6B6B').text(programData.weekly_focus, 50);
    }

    if (programData.motivation_note) {
      doc.moveDown(0.5);
      doc.fontSize(10).fill('#B8965A').text(`"${programData.motivation_note}"`, 50, undefined, {
        align: 'center',
        width: 495,
      });
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#6B6B6B').text('Generated by FitnessByMaddy Coaching System', 50, undefined, { align: 'center', width: 495 });

    doc.end();
  });
}

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
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const programData = await generateWithClaude(client, checkins || []);

    const combined = JSON.stringify(programData);
    if (hasSafetyIssue(combined)) {
      const { escalate } = require('../lib/escalation');
      await escalate(
        client.phone,
        'unsafe_program_generated',
        `Week ${week_no} program flagged for safety review`
      );
      return res.status(200).json({
        success: false,
        reason: 'Program flagged for Maddy review — safety concern detected',
      });
    }

    const pdfBuffer = await generatePDF(programData, client.name, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_focus,
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      week_no.toString(),
      programData.weekly_focus || 'Stay consistent!',
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({
      success: true,
      client_id,
      week_no,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
