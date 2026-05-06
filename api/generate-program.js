const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'less than 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic();
    const prompt = buildPrompt(client, recentCheckins || [], prevPrograms || [], week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    const safetyIssue = SAFETY_FLAGS.find(flag =>
      responseText.toLowerCase().includes(flag)
    );
    if (safetyIssue) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nFlag: "${safetyIssue}"\nProgram NOT auto-sent.`
      );
      return res.status(200).json({ status: 'flagged_for_review', flag: safetyIssue });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch {
      parsed = { workout_plan: { raw: responseText }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload failed:', uploadErr.message);
    }

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: parsed.workout_plan || parsed,
        nutrition_plan: parsed.nutrition_plan || {},
        notes: parsed.notes || null
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      pdfUrl
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)}, week ${week_no}`);
    res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('generate-program error:', err.message);
    res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];
  const prevProg = prevPrograms[0];

  return `You are a NASM-certified fitness program architect for FitnessByMaddy.

Generate a Week ${weekNo} training and nutrition program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}
- Program: ${client.program}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10` : ''}

${prevProg ? `PREVIOUS PROGRAM NOTES: ${prevProg.notes || 'None'}` : ''}

RULES:
- Program must be safe, evidence-based, and progressive
- No extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- No banned substances or supplements
- Account for any injuries or limitations
- Include rest days
- Be specific with sets, reps, and rest periods

Respond in valid JSON with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": "...",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] },
      ...
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Key focus for this week: ..."
}
\`\`\``;
}

function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#ffffff').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 70, { align: 'center' });
    doc.fill('#B8965A').fontSize(11)
      .text(client.name || 'Client', 50, 92, { align: 'center' });

    doc.moveDown(3);

    const workout = program.workout_plan;
    if (workout?.days) {
      doc.fill('#1a1a1a').fontSize(18).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50, doc.y + 10);
      doc.moveDown(0.5);
      doc.rect(50, doc.y, 100, 2).fill('#B8965A');
      doc.moveDown(1);

      for (const day of workout.days) {
        if (doc.y > 700) doc.addPage();

        doc.fill('#1a1a1a').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus || ''}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#444444').fontSize(10).font('Helvetica')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60);
            if (ex.notes) {
              doc.fill('#888888').fontSize(9).text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.8);
      }

      if (workout.cardio) {
        doc.fill('#1a1a1a').fontSize(11).font('Helvetica-Bold').text('Cardio:', 50);
        doc.fill('#444444').fontSize(10).font('Helvetica').text(`  ${workout.cardio}`, 60);
        doc.moveDown(0.5);
      }
    }

    const nutrition = program.nutrition_plan;
    if (nutrition) {
      if (doc.y > 600) doc.addPage();

      doc.moveDown(1);
      doc.fill('#1a1a1a').fontSize(18).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);
      doc.rect(50, doc.y, 100, 2).fill('#B8965A');
      doc.moveDown(1);

      if (nutrition.calories) {
        doc.fill('#1a1a1a').fontSize(11).font('Helvetica-Bold')
          .text(`Daily Targets: ${nutrition.calories} kcal  |  P: ${nutrition.protein_g || '?'}g  |  C: ${nutrition.carbs_g || '?'}g  |  F: ${nutrition.fat_g || '?'}g`, 50);
        doc.moveDown(0.8);
      }

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fill('#1a1a1a').fontSize(11).font('Helvetica-Bold').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill('#444444').fontSize(10).font('Helvetica').text(`  • ${opt}`, 60);
            }
          }
          doc.moveDown(0.5);
        }
      }
    }

    if (program.notes) {
      if (doc.y > 680) doc.addPage();
      doc.moveDown(1);
      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fill('#444444').fontSize(10).font('Helvetica').text(program.notes, 50, doc.y, { width: 495 });
    }

    doc.moveDown(2);
    doc.fill('#cccccc').fontSize(8).font('Helvetica')
      .text('This program is personalized for you by Fitness by Maddy. Do not share or redistribute.', 50, doc.y, { align: 'center', width: 495 });

    doc.end();
  });
}
