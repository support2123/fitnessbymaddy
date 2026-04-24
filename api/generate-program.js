const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendText } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { maskPhone } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedrine', 'sarms',
  'steroids', 'testosterone', 'anavar', 'trenbolone',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast', 'zero calorie',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  try {
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
      .select('week_no, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const prompt = buildPrompt(client, recentCheckins || [], prevPrograms || [], week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) {
      console.error('No JSON block in Claude response');
      return res.status(500).json({ error: 'Invalid program format from AI' });
    }

    const programData = JSON.parse(jsonMatch[1]);
    const fullText = content.toLowerCase();
    const hasSafetyFlag = SAFETY_FLAGS.some(flag => fullText.includes(flag));

    if (hasSafetyFlag) {
      const { sendTemplate } = require('./lib/whatsapp');
      const { notifyMaddy } = require('./lib/escalation');
      await notifyMaddy(
        'Program safety flag',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nFlagged content detected — review before sending.`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'FLAGGED FOR REVIEW — safety concern detected',
      });

      return res.status(200).json({ ok: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = publicUrl?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      pdf_url: pdfUrl,
      notes: programData.coach_note || null,
    });

    const market = detectMarket(client.phone);
    const contextNote = programData.coach_note || `Week ${week_no} plan is ready!`;

    if (isHinglish(market)) {
      await sendText(
        client.phone,
        `Week ${week_no} ka plan ready hai! 🔥\n\n${contextNote}\n\nPDF: ${pdfUrl}`
      );
    } else {
      await sendText(
        client.phone,
        `Your Week ${week_no} plan is ready! 🔥\n\n${contextNote}\n\nPDF: ${pdfUrl}`
      );
    }

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prevNotes = prevPrograms.map(p => `Week ${p.week_no} note: ${p.notes || 'none'}`).join('\n');

  return `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand.

Generate a Week ${weekNo} training and nutrition program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Phone market: ${client.phone ? (client.phone.startsWith('+91') ? 'India' : 'International') : 'Unknown'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

PREVIOUS PROGRAM NOTES:
${prevNotes || 'None (first week)'}

RULES:
- Create a progressive, science-backed plan
- No extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- No banned substances or supplements
- No unrealistic timelines or promises
- Include warm-up and cool-down in workouts
- Adjust based on compliance score and energy levels
- If compliance is low, simplify; if high, progressively overload

Respond with a JSON block (inside \`\`\`json ... \`\`\`) containing:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 65,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "coach_note": "One-liner summary of focus for this week"
}

Provide 5-6 training days with 1-2 rest days. Make it practical and achievable.`;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 3 });
    doc.fontSize(12).fill(gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { characterSpacing: 2 });
    doc.fontSize(10).fill('#999999')
      .text(`Prepared for ${client.name || 'Client'}`, 50, 95);

    doc.moveDown(3);

    if (programData.coach_note) {
      doc.fontSize(11).fill(gold).font('Helvetica-Bold')
        .text('COACH\'S NOTE', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill(charcoal).font('Helvetica')
        .text(programData.coach_note, 50, undefined, { width: 495 });
      doc.moveDown(1.5);
    }

    doc.fontSize(16).fill(charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke(gold);
    doc.moveDown(1);

    if (programData.workout_plan?.days) {
      for (const day of programData.workout_plan.days) {
        if (doc.y > 680) {
          doc.addPage();
        }

        doc.fontSize(12).fill(gold).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc.fontSize(9).fill('#666666').font('Helvetica')
            .text(`Warm-up: ${day.warmup}`, 60, undefined, { width: 480 });
          doc.moveDown(0.3);
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(charcoal).font('Helvetica')
              .text(`• ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60, undefined, { width: 480 });
            if (ex.notes) {
              doc.fontSize(8).fill('#888888')
                .text(`  ${ex.notes}`, 70, undefined, { width: 470 });
            }
          }
        }

        if (day.cooldown) {
          doc.moveDown(0.2);
          doc.fontSize(9).fill('#666666').font('Helvetica')
            .text(`Cool-down: ${day.cooldown}`, 60, undefined, { width: 480 });
        }

        doc.moveDown(1);
      }
    }

    doc.addPage();

    doc.fontSize(16).fill(charcoal).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke(gold);
    doc.moveDown(1);

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
        .text('Daily Targets', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill(charcoal).font('Helvetica')
        .text(`Calories: ${np.daily_calories || '—'} kcal`, 60)
        .text(`Protein: ${np.protein_g || '—'}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fats: ${np.fats_g || '—'}g`, 60);

      if (np.hydration) {
        doc.text(`Hydration: ${np.hydration}`, 60);
      }
      doc.moveDown(1);

      if (np.meals) {
        doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
          .text('Meal Framework', 50);
        doc.moveDown(0.3);

        for (const meal of np.meals) {
          doc.fontSize(10).fill(gold).font('Helvetica-Bold')
            .text(meal.meal, 60);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill(charcoal).font('Helvetica')
                .text(`  • ${opt}`, 70, undefined, { width: 470 });
            }
          }
          doc.moveDown(0.5);
        }
      }

      if (np.supplements && np.supplements.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
          .text('Supplements', 50);
        doc.moveDown(0.3);
        for (const supp of np.supplements) {
          doc.fontSize(9).fill(charcoal).font('Helvetica')
            .text(`  • ${supp}`, 60);
        }
      }
    }

    const bottomY = doc.page.height - 40;
    doc.fontSize(8).fill('#AAAAAA').font('Helvetica')
      .text('fitnessbymaddy.com | This plan is personalised — do not share.', 50, bottomY, {
        width: 495, align: 'center',
      });

    doc.end();
  });
}
