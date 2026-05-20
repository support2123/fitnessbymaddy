const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone, cors } = require('../lib/utils');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

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
      .select('workout_plan, nutrition_plan, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned or unregulated supplements
- Never promise specific weight loss timelines
- Always include rest days (minimum 1-2 per week)
- Nutrition must be practical and culturally appropriate
- If the client reports pain or medical issues, flag it and provide modified exercises
- Output MUST be valid JSON with workout_plan and nutrition_plan keys`;

    const userPrompt = buildPrompt(client, recentCheckins, prevPrograms, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;
    let plans;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      plans = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'AI output parse failure' });
    }

    if (isSafetyFlagged(plans)) {
      await db.from('escalations').insert({
        phone: client.phone,
        reason: 'ai_safety_flag',
        context: `Week ${week_no} program flagged for review`,
      });
      return res.json({ flagged: true, reason: 'Content flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, plans, week_no);

    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError);
    }

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(filePath);

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: plans.workout_plan,
      nutrition_plan: plans.nutrition_plan,
      notes: plans.notes || null,
    });

    const market = (await db.from('leads').select('market').eq('phone', client.phone).single())?.data?.market || 'GLOBAL';
    const contextNote = market === 'IN'
      ? [`Week ${week_no} ka program ready hai! 💪 Check karo aur questions ho toh pooch lo.`]
      : [`Your Week ${week_no} program is ready! 💪 Check it out and let us know if you have questions.`];

    await sendWhatsApp(client.phone, 'weekly_program', contextNote, publicUrl?.publicUrl);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.json({ success: true, client_id, week_no, pdf_url: publicUrl?.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  let prompt = `Generate Week ${weekNo} workout + nutrition plan for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Age: ${client.age || 'Unknown'}\n`;
  prompt += `Goal: ${client.goal || 'General fitness'}\n`;
  prompt += `Injuries/Limitations: ${client.injuries || 'None reported'}\n`;
  prompt += `Diet Preference: ${client.diet_pref || 'No preference'}\n`;
  prompt += `Schedule: ${client.schedule || 'Flexible'}\n\n`;

  if (checkins && checkins.length > 0) {
    prompt += `Recent check-ins:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, `;
      prompt += `Compliance=${c.compliance_score}/10, Energy=${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += `\n`;
    }
  }

  if (prevPrograms && prevPrograms.length > 0) {
    prompt += `\nPrevious week plan summary available for continuity.\n`;
  }

  prompt += `\nReturn JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]},
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
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
  "notes": "Brief coach note for the client"
}`;

  return prompt;
}

function isSafetyFlagged(plans) {
  if (!plans.nutrition_plan) return false;
  const cals = plans.nutrition_plan.calories;
  if (cals && cals < 1200) return true;

  const supps = plans.nutrition_plan.supplements || [];
  const banned = ['dnp', 'clenbuterol', 'ephedra', 'sarm', 'steroid', 'hgh'];
  for (const s of supps) {
    if (banned.some(b => s.toLowerCase().includes(b))) return true;
  }

  return false;
}

function generatePDF(client, plans, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, 595, 80).fill('#2C2C2C');
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 25);
    doc.font('Helvetica').fontSize(10).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 55);

    doc.moveDown(3);

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#2C2C2C')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (plans.workout_plan?.days) {
      for (const day of plans.workout_plan.days) {
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#B8965A')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.font('Helvetica').fontSize(10).fillColor('#333333')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60);
            if (ex.notes) {
              doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B6B6B')
                .text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (plans.workout_plan?.cardio) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#2C2C2C')
        .text('Cardio:', 50);
      doc.font('Helvetica').fontSize(10).fillColor('#333333')
        .text(`  ${plans.workout_plan.cardio}`, 60);
      doc.moveDown(0.5);
    }

    doc.addPage();
    doc.rect(0, 0, 595, 5).fill('#B8965A');
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#2C2C2C')
      .text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    const np = plans.nutrition_plan;
    if (np) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#2C2C2C')
        .text('Daily Targets:', 50);
      doc.font('Helvetica').fontSize(10).fillColor('#333333')
        .text(`  Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 60);
      doc.moveDown(0.5);

      if (np.meals) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#2C2C2C')
          .text('Meal Plan:', 50);
        doc.moveDown(0.3);
        for (const meal of np.meals) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#B8965A')
            .text(`  ${meal.meal}`, 60);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.font('Helvetica').fontSize(9).fillColor('#333333')
                .text(`    • ${opt}`, 70);
            }
          }
          doc.moveDown(0.2);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#2C2C2C')
          .text('Hydration:', 50);
        doc.font('Helvetica').fontSize(9).fillColor('#333333')
          .text(`  ${np.hydration}`, 60);
      }
    }

    if (plans.notes) {
      doc.moveDown(1);
      doc.rect(50, doc.y, 495, 1).fill('#E8E3DC');
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#2C2C2C')
        .text('Coach Notes:', 50);
      doc.font('Helvetica').fontSize(10).fillColor('#6B6B6B')
        .text(plans.notes, 50, undefined, { width: 495 });
    }

    doc.moveDown(2);
    doc.rect(0, doc.y, 595, 40).fill('#2C2C2C');
    doc.font('Helvetica').fontSize(8).fillColor('#6B6B6B')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.y + 12, { align: 'center' });

    doc.end();
  });
}
