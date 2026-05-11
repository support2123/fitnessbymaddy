const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

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

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(200).json({ action: 'already_generated', program_id: existingProgram.id });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, recentCheckins || [], week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    let programData;
    try {
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) ||
                         responseText.match(/\{[\s\S]*"workout_plan"[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : responseText;
      programData = JSON.parse(jsonStr);
    } catch (parseErr) {
      programData = {
        workout_plan: { raw: responseText },
        nutrition_plan: {},
        notes: 'Auto-parsed from raw response'
      };
    }

    if (containsRiskyContent(responseText)) {
      await escalateToMaddy('Program flagged for review - potentially risky content', {
        phone: maskPhone(client.phone),
        message: `Week ${week_no} program for ${client.name} flagged for review`,
        clientName: client.name || 'Unknown'
      });

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || {},
        nutrition_plan: programData.nutrition_plan || {},
        notes: 'FLAGGED FOR REVIEW - not auto-sent'
      });

      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || {},
      nutrition_plan: programData.nutrition_plan || {},
      notes: programData.notes || null
    }).select().single();

    const contextNote = programData.notes || `Week ${week_no} program is ready!`;

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Week ${week_no}`,
        contextNote.substring(0, 200)
      ],
      media: { url: pdfUrl, filename: `week_${week_no}_program.pdf` }
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Current week: ${weekNo}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins available (first week)'}

INSTRUCTIONS:
1. Create a complete weekly workout plan (${weekNo <= 4 ? 'foundation phase' : weekNo <= 8 ? 'progression phase' : 'peak phase'})
2. Create a nutrition plan with daily calories, macros, and 3 meal suggestions
3. Add a brief motivational note personalized to their progress
4. If this is week 1, start with assessment-level intensity

SAFETY RULES (STRICT):
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or unregulated supplements
- Never promise specific weight loss timelines
- If the client reported pain or injury, modify exercises accordingly
- Keep recommendations evidence-based and conservative

Return your response as JSON with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [{ "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "suggestion": "..." },
      { "meal": "Lunch", "suggestion": "..." },
      { "meal": "Dinner", "suggestion": "..." }
    ],
    "hydration": "...",
    "supplements": "..."
  },
  "notes": "Brief motivational note for the client"
}
\`\`\``;
}

function containsRiskyContent(text) {
  const lower = text.toLowerCase();
  const riskyPatterns = [
    /below\s*(800|900|1000|1100)\s*cal/i,
    /starvation/i,
    /clenbuterol|dnp|ephedra|sarm/i,
    /lose\s+\d+\s*(kg|lbs?)\s+in\s+\d+\s*days?/i,
    /guaranteed\s+results/i,
    /no\s+food\s+day|zero\s+calorie\s+day/i
  ];
  return riskyPatterns.some(p => p.test(lower));
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
    doc.fontSize(28).fill('#FFFFFF').text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fontSize(14).fill(gold).text(`WEEK ${weekNo} PROGRAM`, 50, 72, { align: 'left' });
    doc.fontSize(10).fill('#999999').text(client.name || 'Client', 50, 95, { align: 'left' });
    doc.fontSize(10).fill('#999999').text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), 400, 95, { align: 'right' });

    doc.moveDown(3);

    const workout = programData.workout_plan;
    if (workout && workout.days) {
      doc.fontSize(18).fill(charcoal).text('WORKOUT PLAN', 50);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(gold).lineWidth(2).stroke();
      doc.moveDown(0.5);

      for (const day of workout.days) {
        doc.fontSize(13).fill(gold).text(`${day.day} - ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(charcoal)
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60);
            if (ex.notes) {
              doc.fontSize(8).fill('#888888').text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);

        if (doc.y > 700) {
          doc.addPage();
        }
      }

      if (workout.cardio) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill(charcoal).text(`Cardio: ${workout.cardio}`, 50);
      }
    }

    doc.addPage();

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      doc.fontSize(18).fill(charcoal).text('NUTRITION PLAN', 50);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(gold).lineWidth(2).stroke();
      doc.moveDown(0.5);

      doc.fontSize(12).fill(charcoal).text('Daily Targets:', 50);
      doc.fontSize(10).fill('#444444');
      doc.text(`  Calories: ${nutrition.daily_calories || 'TBD'} kcal`, 60);
      doc.text(`  Protein: ${nutrition.protein_g || 'TBD'}g  |  Carbs: ${nutrition.carbs_g || 'TBD'}g  |  Fat: ${nutrition.fat_g || 'TBD'}g`, 60);
      doc.moveDown(0.5);

      if (nutrition.meals) {
        doc.fontSize(12).fill(charcoal).text('Meal Suggestions:', 50);
        doc.moveDown(0.3);
        for (const meal of nutrition.meals) {
          doc.fontSize(10).fill(gold).text(`  ${meal.meal}:`, 60);
          doc.fontSize(10).fill('#444444').text(`  ${meal.suggestion}`, 70);
          doc.moveDown(0.3);
        }
      }

      if (nutrition.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill(charcoal).text(`Hydration: ${nutrition.hydration}`, 50);
      }

      if (nutrition.supplements) {
        doc.fontSize(10).fill(charcoal).text(`Supplements: ${nutrition.supplements}`, 50);
      }
    }

    if (programData.notes) {
      doc.moveDown(1.5);
      doc.rect(50, doc.y, 495, 60).fill('#FAF8F4').stroke();
      doc.fontSize(10).fill(gold).text('NOTE FROM MADDY', 65, doc.y - 50);
      doc.fontSize(10).fill(charcoal).text(programData.notes, 65, doc.y + 5, { width: 465 });
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#AAAAAA').text('Generated by Fitness by Maddy | fitnessbymaddy.com', 50, 760, { align: 'center' });

    doc.end();
  });
}
