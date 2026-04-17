const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');
const { parseBody, json } = require('../lib/utils');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const RISKY_KEYWORDS = [
  'below 1200 calories', 'below 1000 calories', 'starvation',
  'clenbuterol', 'dnp', 'steroids', 'anabolic', 'sarms',
  'lose 10kg in 1 week', 'lose 20 pounds in',
  'extreme deficit', 'very low calorie',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const internalKey = req.headers['x-internal-key'];
  if (internalKey !== process.env.SUPABASE_SERVICE_KEY) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const { client_id, week_no } = await parseBody(req);
  if (!client_id || !week_no) {
    return json(res, 400, { error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return json(res, 404, { error: 'Client not found' });

  const { data: intake } = await db
    .from('lead_intake')
    .select('*')
    .eq('lead_id', client.lead_id)
    .single();

  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, a premium online coaching brand. Create personalised weekly training and nutrition plans.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "weekly_notes": "..."
  },
  "context_note": "One-liner summary of this week's focus for WhatsApp"
}

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or supplements requiring medical oversight
- Never promise specific weight loss timelines
- Progressive overload: increase volume or intensity from previous weeks
- Be specific with exercise names, sets, reps, and rest periods
- Adjust based on check-in data (compliance, energy, issues reported)`;

  const userPrompt = `Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
${intake ? `- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Injuries: ${intake.injuries || 'none reported'}
- Diet Preference: ${intake.diet_pref || 'no preference'}
- Schedule: ${intake.schedule || 'flexible'}
- Experience: ${intake.experience || 'intermediate'}
- Medical: ${intake.medical_conditions || 'none'}` : '- No intake form submitted yet'}

${checkins && checkins.length > 0 ? `Recent Check-ins:
${checkins.map(c => `Week ${c.week_no}: Weight=${c.weight || '?'}kg, Waist=${c.waist || '?'}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No check-in data yet (first week).'}

Generate Week ${week_no} program.`;

  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return json(res, 500, { error: 'Program generation failed' });
  }

  const outputStr = JSON.stringify(programData).toLowerCase();
  const riskyMatch = RISKY_KEYWORDS.find(kw => outputStr.includes(kw));
  if (riskyMatch) {
    await notifyMaddy(
      'Risky program content flagged',
      `Client: ${client.name || client_id}\nWeek: ${week_no}\nFlag: "${riskyMatch}"\nProgram halted — needs manual review.`
    );
    return json(res, 200, { flagged: true, reason: riskyMatch });
  }

  let pdfBuffer;
  try {
    pdfBuffer = await generatePDF(client, week_no, programData);
  } catch (err) {
    console.error('PDF generation error:', err.message);
    return json(res, 500, { error: 'PDF generation failed' });
  }

  const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
  const { error: uploadError } = await db.storage
    .from('programs')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    console.error('PDF upload error:', uploadError.message);
    return json(res, 500, { error: 'PDF upload failed' });
  }

  const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || '';

  const { error: programError } = await db.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.context_note || null,
  });

  if (programError) {
    console.error('Program record error:', programError.message);
  }

  const contextNote = programData.context_note || `Week ${week_no} program ready!`;
  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no),
    contextNote,
  ], pdfUrl);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

  return json(res, 200, { success: true, pdf_url: pdfUrl, week_no });
};

function generatePDF(client, weekNo, programData) {
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
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 4 });
    doc.fontSize(14).fill(gold).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { characterSpacing: 2 });

    doc.moveDown(3);
    doc.fontSize(11).fill(charcoal).font('Helvetica')
      .text(`Client: ${client.name || 'Client'}`, 50)
      .text(`Program: ${client.program}`, 50)
      .text(`Week: ${weekNo}`, 50)
      .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);

    doc.moveDown(1.5);
    doc.rect(50, doc.y, doc.page.width - 100, 2).fill(gold);
    doc.moveDown(1);

    doc.fontSize(18).fill(charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    const wp = programData.workout_plan;
    if (wp && wp.days) {
      for (const day of wp.days) {
        if (doc.y > 680) doc.addPage();

        doc.fontSize(13).fill(gold).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc.fontSize(9).fill('#6B6B6B').font('Helvetica')
            .text(`Warm-up: ${day.warmup}`, 60);
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(charcoal).font('Helvetica')
              .text(`• ${ex.name} — ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`, 60, undefined, { width: 480 });
          }
        }

        if (day.cooldown) {
          doc.fontSize(9).fill('#6B6B6B').font('Helvetica')
            .text(`Cool-down: ${day.cooldown}`, 60);
        }
        doc.moveDown(0.8);
      }
    }

    if (wp && wp.weekly_notes) {
      doc.fontSize(9).fill('#6B6B6B').font('Helvetica-Oblique')
        .text(wp.weekly_notes, 50, undefined, { width: 500 });
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill(charcoal);
    doc.fontSize(18).fill('#FFFFFF').font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 20, { characterSpacing: 2 });

    doc.moveDown(2);
    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
        .text('Daily Targets', 50);
      doc.fontSize(10).fill(charcoal).font('Helvetica')
        .text(`Calories: ${np.daily_calories || '—'} kcal  |  Protein: ${np.protein_g || '—'}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fat: ${np.fat_g || '—'}g`, 50);
      doc.moveDown(1);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(12).fill(gold).font('Helvetica-Bold')
            .text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill(charcoal).font('Helvetica')
                .text(`• ${opt}`, 60, undefined, { width: 480 });
            }
          }
          if (meal.macros) {
            doc.fontSize(9).fill('#6B6B6B').font('Helvetica')
              .text(`Macros: ${meal.macros}`, 60);
          }
          doc.moveDown(0.5);
        }
      }

      if (np.supplements && np.supplements.length) {
        doc.moveDown(0.5);
        doc.fontSize(11).fill(charcoal).font('Helvetica-Bold').text('Supplements', 50);
        for (const s of np.supplements) {
          doc.fontSize(10).fill(charcoal).font('Helvetica').text(`• ${s}`, 60);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill(charcoal).font('Helvetica')
          .text(`Hydration: ${np.hydration}`, 50);
      }
    }

    doc.moveDown(2);
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill('#E8E3DC');
    doc.moveDown(0.5);
    doc.fontSize(8).fill('#999999').font('Helvetica')
      .text('This program is personalised for you by FitnessByMaddy. Do not share or redistribute.', 50, undefined, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}
