const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'very low calorie'
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

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect AI. You create personalized weekly fitness programs.
Output valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + shoulder dislocations",
        "cooldown": "Stretch 5 min"
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "cardio": "3x20min LISS post-workout"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "context_note": "Brief 1-liner for WhatsApp delivery",
  "safety_flag": false
}

Rules:
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or steroids
- Progressive overload from previous weeks
- Account for reported injuries/issues
- Be culturally appropriate (Indian diet options for IN market clients)
- If anything seems medically risky, set safety_flag to true`;

    const userPrompt = buildUserPrompt(client, checkins, prevPrograms, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse program JSON from Claude response');
    }

    const program = JSON.parse(jsonMatch[0]);

    const outputText = JSON.stringify(program).toLowerCase();
    const hasSafetyIssue = program.safety_flag ||
      SAFETY_FLAGS.some(flag => outputText.includes(flag));

    if (hasSafetyIssue) {
      await notifyMaddy(
        'Program flagged for review',
        `Client ${maskPhone(client.phone)} Week ${week_no} — auto-generated program has safety concerns. Review before sending.`
      );
      await supabase.from('programs').insert({
        client_id, week_no,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: `FLAGGED: ${program.context_note || 'Safety review needed'}`
      });
      return res.status(200).json({ ok: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(client, program, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData.publicUrl;

    const { error: progErr } = await supabase.from('programs').insert({
      client_id, week_no,
      pdf_url: pdfUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.context_note || null
    });

    if (progErr) throw progErr;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      program.context_note || `Week ${week_no} program is ready!`
    ], pdfUrl);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, checkins, prevPrograms, weekNo) {
  let prompt = `Generate Week ${weekNo} program for:\n`;
  prompt += `- Name: ${client.name || 'Client'}\n`;
  prompt += `- Program: ${client.program}\n`;
  prompt += `- Started: ${client.program_started_at}\n\n`;

  if (checkins && checkins.length > 0) {
    prompt += 'Recent check-ins:\n';
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, `;
      prompt += `Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  if (prevPrograms && prevPrograms.length > 0) {
    prompt += '\nPrevious week plan summary:\n';
    prompt += JSON.stringify(prevPrograms[0].workout_plan, null, 2).slice(0, 500);
    if (prevPrograms[0].notes) prompt += `\nNotes: ${prevPrograms[0].notes}`;
  }

  prompt += `\n\nProgress the training appropriately for Week ${weekNo}. `;
  prompt += 'Adjust volume/intensity based on compliance and energy levels.';

  return prompt;
}

async function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fill('#B8965A')
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 50, { characterSpacing: 4 });

    doc.fill('#ffffff')
      .fontSize(32)
      .font('Helvetica-Bold')
      .text(`WEEK ${weekNo}`, 50, 90);

    doc.fill('#B8965A')
      .fontSize(14)
      .font('Helvetica')
      .text(`${client.name || 'Client'} · ${(client.program || '').toUpperCase()}`, 50, 130);

    doc.moveTo(50, 160).lineTo(545, 160).stroke('#B8965A');

    let y = 180;

    if (program.workout_plan && program.workout_plan.days) {
      doc.fill('#B8965A').fontSize(16).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of program.workout_plan.days) {
        if (y > 720) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
          y = 50;
        }

        doc.fill('#ffffff').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.warmup) {
          doc.fill('#999999').fontSize(9).font('Helvetica')
            .text(`Warmup: ${day.warmup}`, 60, y);
          y += 14;
        }

        for (const ex of (day.exercises || [])) {
          doc.fill('#cccccc').fontSize(10).font('Helvetica')
            .text(`→ ${ex.name}  ${ex.sets}×${ex.reps}  Rest: ${ex.rest}`, 60, y);
          y += 14;
          if (ex.notes) {
            doc.fill('#888888').fontSize(8).text(`   ${ex.notes}`, 70, y);
            y += 12;
          }
        }
        y += 10;
      }

      if (program.workout_plan.cardio) {
        doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold')
          .text(`Cardio: ${program.workout_plan.cardio}`, 50, y);
        y += 20;
      }
    }

    if (program.nutrition_plan) {
      if (y > 600) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
        y = 50;
      }

      doc.fill('#B8965A').fontSize(16).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50, y);
      y += 25;

      const np = program.nutrition_plan;
      doc.fill('#ffffff').fontSize(11).font('Helvetica')
        .text(`Calories: ${np.calories} kcal  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fat_g}g`, 50, y);
      y += 22;

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold')
            .text(meal.meal, 60, y);
          y += 15;
          for (const opt of (meal.options || [])) {
            doc.fill('#cccccc').fontSize(9).font('Helvetica')
              .text(`• ${opt}`, 70, y);
            y += 13;
          }
          y += 5;
        }
      }

      if (np.supplements && np.supplements.length > 0) {
        doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold')
          .text('Supplements:', 60, y);
        y += 15;
        doc.fill('#cccccc').fontSize(9).font('Helvetica')
          .text(np.supplements.join(', '), 70, y);
        y += 15;
      }
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fill('#666666').fontSize(8).font('Helvetica')
        .text(
          'fitnessbymaddy.com · This program is personalized — do not share.',
          50, doc.page.height - 40,
          { align: 'center', width: doc.page.width - 100 }
        );
    }

    doc.end();
  });
}
