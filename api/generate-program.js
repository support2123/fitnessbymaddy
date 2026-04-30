const supabase = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_KEYWORDS = [
  'steroid', 'anabolic', 'dnp', 'clenbuterol', 'ephedra',
  'under 800 cal', 'under 900 cal', 'under 1000 cal',
  'crash diet', 'water fast', 'dry fast',
  '10 kg in 1 week', '20 lbs in a week'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect — an expert fitness coach and nutritionist.
You design weekly workout and nutrition plans for online coaching clients.

Rules:
- Plans must be safe, evidence-based, and progressive
- Never recommend banned substances, extreme calorie restriction (<1200 cal for women, <1500 for men), or unrealistic timelines
- Account for injuries, medical conditions, and preferences
- Output valid JSON only — no markdown, no commentary outside JSON
- Workouts: 4-6 days/week, specify sets/reps/rest
- Nutrition: daily calorie target, macros (protein/carbs/fat), 3 meal ideas + 1 snack
- Include a 1-line motivational note for the client`;

    const userPrompt = buildPrompt(client, recentCheckins, prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Invalid program output' });
    }

    const contentStr = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_KEYWORDS.some(kw => contentStr.includes(kw));

    if (flagged) {
      await supabase.from('programs').insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: parsed.workout_plan || parsed.workout || null,
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition || null,
        notes: parsed.note || parsed.motivation || null,
        flagged_for_review: true
      });

      const { notifyMaddy } = require('../lib/whatsapp');
      await notifyMaddy(
        'Program Flagged for Review',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nReason: Safety keyword detected — please review before sending.`
      );

      return res.status(200).json({ success: true, flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || null;

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: parsed.workout_plan || parsed.workout || null,
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition || null,
        notes: parsed.note || parsed.motivation || null,
        pdf_url: pdfUrl,
        flagged_for_review: false
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Week ${week_no}`,
        parsed.note || parsed.motivation || 'Let\'s crush this week!'
      ],
      media: pdfUrl ? { url: pdfUrl, filename: `week_${week_no}_program.pdf` } : {}
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;
  if (client.age) prompt += `Age: ${client.age}\n`;
  if (client.goal) prompt += `Goal: ${client.goal}\n`;
  if (client.injuries) prompt += `Injuries/Conditions: ${client.injuries}\n`;
  if (client.diet_pref) prompt += `Diet Preference: ${client.diet_pref}\n`;
  if (client.schedule) prompt += `Schedule: ${client.schedule}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, `;
      prompt += `Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += `\n`;
    }
  }

  if (prevProgram) {
    prompt += `\nPrevious week plan summary available — progressively overload or adjust based on check-in data.\n`;
  }

  prompt += `\nRespond with a JSON object containing:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "macros": { "protein_g": 150, "carbs_g": 200, "fat_g": 67 },
    "meals": [
      { "meal": "Breakfast", "options": ["..."] },
      { "meal": "Lunch", "options": ["..."] },
      { "meal": "Dinner", "options": ["..."] },
      { "meal": "Snack", "options": ["..."] }
    ]
  },
  "note": "One motivational line for the client"
}`;

  return prompt;
}

function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fill('#B8965A')
      .fontSize(10)
      .font('Helvetica')
      .text('FITNESS BY MADDY', 50, 40, { characterSpacing: 4 });

    doc.fill('#FFFFFF')
      .fontSize(32)
      .font('Helvetica-Bold')
      .text(`WEEK ${weekNo}`, 50, 70);

    doc.fill('#B8965A')
      .fontSize(12)
      .font('Helvetica')
      .text(`Program: ${client.program?.toUpperCase() || '12WK'}  |  Client: ${client.name || 'Client'}`, 50, 110);

    doc.moveTo(50, 140).lineTo(545, 140).stroke('#B8965A');

    let y = 160;

    const workout = program.workout_plan || program.workout;
    if (workout?.days) {
      doc.fill('#B8965A').fontSize(16).font('Helvetica-Bold').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of workout.days) {
        if (y > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
          y = 50;
        }

        doc.fill('#FFFFFF').fontSize(13).font('Helvetica-Bold').text(`${day.day} — ${day.focus || ''}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) {
              doc.addPage();
              doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
              y = 50;
            }
            const line = `  ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`;
            doc.fill('#CCCCCC').fontSize(10).font('Helvetica').text(line, 60, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    if (y > 600) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
      y = 50;
    }

    const nutrition = program.nutrition_plan || program.nutrition;
    if (nutrition) {
      y += 10;
      doc.fill('#B8965A').fontSize(16).font('Helvetica-Bold').text('NUTRITION PLAN', 50, y);
      y += 25;

      if (nutrition.daily_calories) {
        doc.fill('#FFFFFF').fontSize(11).font('Helvetica-Bold')
          .text(`Daily Target: ${nutrition.daily_calories} kcal`, 50, y);
        y += 18;
      }

      if (nutrition.macros) {
        const m = nutrition.macros;
        doc.fill('#CCCCCC').fontSize(10).font('Helvetica')
          .text(`Protein: ${m.protein_g}g  |  Carbs: ${m.carbs_g}g  |  Fat: ${m.fat_g}g`, 50, y);
        y += 22;
      }

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 720) {
            doc.addPage();
            doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
            y = 50;
          }
          doc.fill('#FFFFFF').fontSize(11).font('Helvetica-Bold').text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill('#CCCCCC').fontSize(10).font('Helvetica').text(`  • ${opt}`, 60, y);
              y += 14;
            }
          }
          y += 6;
        }
      }
    }

    const note = program.note || program.motivation;
    if (note) {
      if (y > 700) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
        y = 50;
      }
      y += 20;
      doc.moveTo(50, y).lineTo(545, y).stroke('#B8965A');
      y += 15;
      doc.fill('#B8965A').fontSize(11).font('Helvetica-Oblique').text(`"${note}"`, 50, y, { width: 495, align: 'center' });
    }

    doc.end();
  });
}
