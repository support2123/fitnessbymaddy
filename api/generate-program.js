const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalate');
const Anthropic = require('@anthropic-ai/sdk');

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

    const { data: checkins } = await supabase
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

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Design weekly training and nutrition plans that are:
- Evidence-based and safe
- Progressive (building on previous weeks)
- Tailored to the client's goals, constraints, and feedback
- Never recommending extreme calorie deficits (<1200 kcal), banned substances, or unrealistic timelines

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "...", "macros": "..." }
    ],
    "hydration": "...",
    "supplements": []
  },
  "weekly_focus": "...",
  "notes_for_client": "..."
}`;

    const userPrompt = buildUserPrompt(client, checkins, prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const programText = response.content[0].text;
    let programData;

    try {
      programData = JSON.parse(programText);
    } catch {
      const jsonMatch = programText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        programData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse program JSON from Claude');
      }
    }

    if (programData.nutrition_plan && programData.nutrition_plan.calories < 1200) {
      await escalateToMaddy('unsafe_program', {
        clientName: client.name,
        phone: client.phone,
        message: `Week ${week_no} program has calories below 1200. Halted for review.`
      });
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.notes_for_client || ''
      })
      .select()
      .single();

    if (error) throw error;

    const pdfUrl = await generateAndUploadPDF(client, programData, week_no);

    await supabase
      .from('programs')
      .update({ pdf_url: pdfUrl, whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name,
      templateParams: [client.name, week_no.toString(), programData.weekly_focus || 'Stay consistent!'],
      media: { url: pdfUrl, filename: `week_${week_no}_program.pdf` }
    });

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, checkins, prevProgram, weekNo) {
  const intake = client.intake_data || {};
  let prompt = `CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Goal: ${intake.goal || 'general fitness'}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Experience: ${intake.experience_level || 'intermediate'}
- Injuries/Limitations: ${intake.injuries || 'none reported'}
- Diet Preference: ${intake.diet_preference || 'no restrictions'}
- Schedule: ${intake.schedule || '4-5 days/week'}
- Medical: ${intake.medical_conditions || 'none'}
`;

  if (checkins && checkins.length > 0) {
    prompt += '\nRECENT CHECK-INS:\n';
    checkins.forEach(c => {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, `;
      prompt += `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    });
  }

  if (prevProgram) {
    prompt += `\nPREVIOUS WEEK PLAN SUMMARY:
- Workout focus areas: ${JSON.stringify(prevProgram.workout_plan?.days?.map(d => d.focus) || [])}
- Calories: ${prevProgram.nutrition_plan?.calories || 'N/A'}
- Notes: ${prevProgram.notes || 'none'}
`;
  }

  prompt += `\nDesign Week ${weekNo} program. Progress appropriately from previous week.`;
  return prompt;
}

async function generateAndUploadPDF(client, programData, weekNo) {
  const PDFDocument = require('pdfkit');

  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', async () => {
        const pdfBuffer = Buffer.concat(chunks);
        const filePath = `clients/${client.id}/week_${weekNo}.pdf`;

        const { error } = await supabase.storage
          .from('programs')
          .upload(filePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true
          });

        if (error) return reject(error);

        const { data: urlData } = supabase.storage
          .from('programs')
          .getPublicUrl(filePath);

        resolve(urlData.publicUrl);
      });

      doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
      doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 40);
      doc.fontSize(14).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 80);
      doc.fontSize(11).fill('#D4AF7A').text(client.name.toUpperCase(), 50, 100);

      doc.moveDown(4);

      doc.fontSize(16).fill('#2C2C2C').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
      doc.moveDown(0.5);

      if (programData.workout_plan && programData.workout_plan.days) {
        programData.workout_plan.days.forEach(day => {
          doc.fontSize(12).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
          doc.moveDown(0.3);
          if (day.exercises) {
            day.exercises.forEach(ex => {
              doc.fontSize(10).fill('#6B6B6B')
                .text(`  • ${ex.name}: ${ex.sets} × ${ex.reps} (Rest: ${ex.rest})`, 60);
            });
          }
          doc.moveDown(0.5);
        });
      }

      if (programData.workout_plan && programData.workout_plan.cardio) {
        doc.moveDown(0.5);
        doc.fontSize(11).fill('#2C2C2C').text('Cardio:', 50);
        const c = programData.workout_plan.cardio;
        doc.fontSize(10).fill('#6B6B6B').text(`  ${c.type} — ${c.frequency}, ${c.duration}`, 60);
      }

      doc.addPage();
      doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
      doc.fontSize(14).fill('#B8965A').text('NUTRITION PLAN', 50, 25);

      doc.moveDown(3);

      if (programData.nutrition_plan) {
        const np = programData.nutrition_plan;
        doc.fontSize(12).fill('#2C2C2C').text('Daily Targets:', 50);
        doc.fontSize(10).fill('#6B6B6B')
          .text(`  Calories: ${np.calories} kcal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fats: ${np.fats_g}g`, 60);
        doc.moveDown(1);

        if (np.meal_framework) {
          doc.fontSize(12).fill('#2C2C2C').text('Meal Framework:', 50);
          doc.moveDown(0.3);
          np.meal_framework.forEach(meal => {
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  ${meal.meal}: ${meal.suggestion}`, 60);
          });
        }

        doc.moveDown(1);
        if (np.hydration) {
          doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${np.hydration}`, 50);
        }
      }

      if (programData.notes_for_client) {
        doc.moveDown(2);
        doc.fontSize(12).fill('#2C2C2C').text('Coach Notes:', 50);
        doc.moveDown(0.3);
        doc.fontSize(10).fill('#6B6B6B').text(programData.notes_for_client, 60, doc.y, { width: 480 });
      }

      doc.moveDown(3);
      doc.fontSize(8).fill('#B8965A').text('© FitnessByMaddy — This program is personalised. Do not share.', 50, doc.page.height - 50);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
