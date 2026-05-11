const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getClient } = require('../lib/supabase');
const { sendTemplate, sendToMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const UNSAFE_PATTERNS = [
  /under\s*\d{3}\s*cal/i,
  /800\s*cal/i, /700\s*cal/i, /600\s*cal/i, /500\s*cal/i,
  /clenbuterol/i, /dnp/i, /ephedra/i, /sarm/i, /steroid/i,
  /lose\s*\d+\s*kg\s*in\s*\d+\s*day/i,
  /extreme\s*(cut|diet|fast)/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sb = getClient();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await sb
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: recentCheckins } = await sb
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: prevPrograms } = await sb
    .from('programs')
    .select('workout_plan, nutrition_plan, notes, week_no')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(1);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are Maddy's program architect — an expert fitness coach and nutritionist.
You create weekly training and nutrition plans for clients in Maddy's coaching business.

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "summary": "brief weekly focus",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "description of cardio recommendation",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 65,
    "meal_timing": ["Meal 1: ...", "Meal 2: ..."],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily",
    "notes": "any dietary notes"
  },
  "coach_notes": "personalized message from coach"
}

Rules:
- Never recommend under 1200 calories for women or 1500 for men
- Never recommend banned substances, SARMs, steroids, or stimulant fat burners
- Be realistic with timelines — max 0.5-1% bodyweight loss per week
- Adjust based on check-in data: compliance, energy, weight trends
- If client reports pain or injury, note it and recommend rest/modification
- Keep language warm and motivating, not bro-science`;

  const userPrompt = buildUserPrompt(client, recentCheckins, prevPrograms, week_no);

  let completion;
  try {
    completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(500).json({ error: 'AI generation failed' });
  }

  const rawText = completion.content[0]?.text || '';
  let parsed;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('JSON parse error from Claude output');
    await sendToMaddy(`PROGRAM GEN FAILED\nClient: ${maskPhone(client.phone)}\nWeek: ${week_no}\nReason: Could not parse AI output`);
    return res.status(500).json({ error: 'Failed to parse program output' });
  }

  const fullText = JSON.stringify(parsed);
  const isSafe = !UNSAFE_PATTERNS.some(p => p.test(fullText));
  if (!isSafe) {
    await sendToMaddy(
      `SAFETY FLAG — PROGRAM HALTED\nClient: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReason: Content flagged as potentially unsafe. Manual review required.`
    );
    return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
  }

  const pdfBuffer = await generatePDF(client, parsed, week_no);

  const filePath = `clients/${client_id}/week_${week_no}.pdf`;
  const { error: uploadError } = await sb.storage
    .from('programs')
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (uploadError) {
    console.error('PDF upload failed:', uploadError.message);
  }

  const { data: urlData } = sb.storage
    .from('programs')
    .getPublicUrl(filePath);

  const pdfUrl = urlData?.publicUrl || filePath;

  await sb.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: parsed.workout_plan,
    nutrition_plan: parsed.nutrition_plan,
    notes: parsed.coach_notes || null
  });

  await sendTemplate(client.phone, 'weekly_program', {
    name: client.name || 'there',
    templateParams: [
      client.name || 'there',
      String(week_no)
    ],
    media: { url: pdfUrl, filename: `Week_${week_no}_Program.pdf` }
  });

  await sb.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ ok: true, week_no, pdfUrl });
};

function buildUserPrompt(client, checkins, prevPrograms, weekNo) {
  let prompt = `Create Week ${weekNo} program for this client:\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Phone market: ${client.phone?.startsWith('+91') ? 'India' : 'International'}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-in data:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: weight=${c.weight || 'N/A'}kg, waist=${c.waist || 'N/A'}cm, `;
      prompt += `compliance=${c.compliance_score || 'N/A'}/10, energy=${c.energy || 'N/A'}/10`;
      if (c.issues) prompt += `, issues: "${c.issues}"`;
      prompt += `\n`;
    }
  } else {
    prompt += `\nNo previous check-in data (first week).\n`;
  }

  if (prevPrograms && prevPrograms.length > 0) {
    const prev = prevPrograms[0];
    prompt += `\nPrevious week (${prev.week_no}) plan summary:\n`;
    if (prev.workout_plan?.summary) prompt += `  Workout: ${prev.workout_plan.summary}\n`;
    if (prev.nutrition_plan?.calories) prompt += `  Calories: ${prev.nutrition_plan.calories}\n`;
    if (prev.notes) prompt += `  Notes: ${prev.notes}\n`;
    prompt += `\nProgress the plan appropriately for week ${weekNo}.\n`;
  }

  return prompt;
}

function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 50, right: 50 }
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fill('#B8965A')
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 40, { characterSpacing: 4 });

    doc.moveTo(50, 65).lineTo(545, 65).stroke('#B8965A');

    doc.fill('#FFFFFF')
      .fontSize(32)
      .font('Helvetica-Bold')
      .text(`WEEK ${weekNo}`, 50, 90);

    doc.fill('#B8965A')
      .fontSize(14)
      .text('TRAINING & NUTRITION PLAN', 50, 130);

    doc.fill('#999999')
      .fontSize(10)
      .font('Helvetica')
      .text(`Client: ${client.name || 'Client'} | Program: ${(client.program || '').replace(/_/g, ' ').toUpperCase()}`, 50, 155);

    let y = 190;

    if (plan.workout_plan) {
      doc.fill('#B8965A').fontSize(16).font('Helvetica-Bold').text('WORKOUT PLAN', 50, y);
      y += 25;

      if (plan.workout_plan.summary) {
        doc.fill('#CCCCCC').fontSize(10).font('Helvetica').text(plan.workout_plan.summary, 50, y, { width: 495 });
        y += 20;
      }

      if (plan.workout_plan.days) {
        for (const day of plan.workout_plan.days) {
          if (y > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }

          doc.fill('#FFFFFF').fontSize(12).font('Helvetica-Bold').text(`${day.day} — ${day.focus || ''}`, 50, y);
          y += 18;

          if (day.exercises) {
            for (const ex of day.exercises) {
              if (y > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
              const line = `  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`;
              doc.fill('#CCCCCC').fontSize(9).font('Helvetica').text(line, 60, y, { width: 480 });
              y += 14;
              if (ex.notes) {
                doc.fill('#999999').fontSize(8).text(`    ${ex.notes}`, 60, y, { width: 480 });
                y += 12;
              }
            }
          }
          y += 8;
        }
      }

      if (plan.workout_plan.cardio) {
        if (y > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
        doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold').text('Cardio:', 50, y);
        y += 14;
        doc.fill('#CCCCCC').fontSize(9).font('Helvetica').text(plan.workout_plan.cardio, 60, y, { width: 480 });
        y += 20;
      }
    }

    if (plan.nutrition_plan) {
      if (y > 600) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }

      doc.moveTo(50, y).lineTo(545, y).stroke('#333333');
      y += 20;

      doc.fill('#B8965A').fontSize(16).font('Helvetica-Bold').text('NUTRITION PLAN', 50, y);
      y += 25;

      const np = plan.nutrition_plan;
      const macroLine = `Calories: ${np.calories || 'TBD'} | Protein: ${np.protein_g || '—'}g | Carbs: ${np.carbs_g || '—'}g | Fat: ${np.fat_g || '—'}g`;
      doc.fill('#FFFFFF').fontSize(10).font('Helvetica-Bold').text(macroLine, 50, y);
      y += 20;

      if (np.meal_timing) {
        for (const meal of np.meal_timing) {
          if (y > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
          doc.fill('#CCCCCC').fontSize(9).font('Helvetica').text(meal, 60, y, { width: 480 });
          y += 14;
        }
        y += 8;
      }

      if (np.supplements) {
        doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold').text('Supplements:', 50, y);
        y += 14;
        doc.fill('#CCCCCC').fontSize(9).font('Helvetica').text(np.supplements.join(', '), 60, y, { width: 480 });
        y += 16;
      }

      if (np.hydration) {
        doc.fill('#999999').fontSize(9).font('Helvetica').text(`Hydration: ${np.hydration}`, 50, y);
        y += 16;
      }
    }

    if (plan.coach_notes) {
      if (y > 660) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
      doc.moveTo(50, y).lineTo(545, y).stroke('#333333');
      y += 20;
      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('COACH\'S NOTE', 50, y);
      y += 18;
      doc.fill('#CCCCCC').fontSize(10).font('Helvetica').text(plan.coach_notes, 50, y, { width: 495 });
    }

    doc.end();
  });
}
