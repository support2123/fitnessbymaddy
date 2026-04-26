const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendText, notifyMaddy, maskPhone } = require('../lib/whatsapp');

const SYSTEM_PROMPT = `You are Maddy's Program Architect — an expert fitness coach AI that generates personalised weekly workout and nutrition plans.

RULES:
- Programs must be safe, evidence-based, and appropriate for the client's level
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without strong evidence
- Never promise unrealistic timelines ("lose 10kg in 1 week")
- If the client reports pain, injury, or medical issues, flag for human review instead of programming around it
- Provide progressive overload week-over-week
- Include warm-up and cool-down in every session
- Nutrition should be practical, culturally appropriate, and sustainable

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "overview": "string",
    "days": [
      {
        "day": "Monday",
        "focus": "string",
        "exercises": [
          { "name": "string", "sets": number, "reps": "string", "rest": "string", "notes": "string" }
        ],
        "warmup": "string",
        "cooldown": "string"
      }
    ],
    "rest_days": ["string"]
  },
  "nutrition_plan": {
    "daily_calories": number,
    "macros": { "protein_g": number, "carbs_g": number, "fat_g": number },
    "meal_framework": [
      { "meal": "string", "description": "string", "example": "string" }
    ],
    "hydration": "string",
    "supplements": ["string"]
  },
  "coach_notes": "string",
  "safety_flag": false
}

If ANYTHING seems risky or you're unsure, set "safety_flag": true and explain in "coach_notes".`;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: lastProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      try { intakeData = JSON.parse(lead?.first_msg || '{}'); } catch { intakeData = {}; }
    }

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Unknown'}
- Program: ${client.program}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
- Intake Data: ${JSON.stringify(intakeData)}

RECENT CHECK-INS:
${recentCheckins?.length ? recentCheckins.map(c =>
  `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || 'none'}`
).join('\n') : 'No check-ins yet (first week)'}

LAST WEEK'S PROGRAM:
${lastProgram ? JSON.stringify(lastProgram.workout_plan) : 'None (first week)'}

Generate the next week's personalized plan with appropriate progression.`;

    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = message.content[0].text;
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Failed to parse program JSON from Claude response');
    }

    if (programData.safety_flag) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nNotes: ${programData.coach_notes}`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: `⚠️ FLAGGED: ${programData.coach_notes}`
      });
      return res.json({ action: 'flagged_for_review', notes: programData.coach_notes });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) console.error('PDF upload error:', uploadError.message);

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes
    });

    if (insertError) throw insertError;

    const market = client.phone.startsWith('+91') || client.phone.startsWith('91') ? 'IN' : 'GLOBAL';
    const contextNote = programData.coach_notes || `Week ${week_no} program ready!`;

    if (market === 'IN') {
      await sendText(client.phone,
        `Hey ${client.name || 'there'}! 🔥\n\n` +
        `Tumhara Week ${week_no} ka program ready hai!\n\n` +
        `📋 ${contextNote}\n\n` +
        `PDF: ${pdfUrl}\n\n` +
        `Koi doubt ho toh poocho! 💪`
      );
    } else {
      await sendText(client.phone,
        `Hey ${client.name || 'there'}! 🔥\n\n` +
        `Your Week ${week_no} program is ready!\n\n` +
        `📋 ${contextNote}\n\n` +
        `PDF: ${pdfUrl}\n\n` +
        `Any questions? Just ask! 💪`
      );
    }

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.json({ action: 'program_generated', week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generatePDF(client, weekNo, programData) {
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
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill(gold).font('Helvetica')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75);
    doc.fontSize(10).fill('#999999')
      .text(`Program: ${client.program} | Generated: ${new Date().toLocaleDateString()}`, 50, 95);

    doc.moveDown(3);

    const wp = programData.workout_plan;
    if (wp) {
      doc.fontSize(18).fill(gold).font('Helvetica-Bold').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      doc.fontSize(11).fill(charcoal).font('Helvetica').text(wp.overview || '', 50);
      doc.moveDown(1);

      if (wp.days) {
        for (const day of wp.days) {
          doc.fontSize(14).fill(charcoal).font('Helvetica-Bold')
            .text(`${day.day} — ${day.focus}`, 50);
          doc.moveDown(0.3);

          if (day.warmup) {
            doc.fontSize(9).fill('#666666').font('Helvetica')
              .text(`Warm-up: ${day.warmup}`, 60);
          }

          if (day.exercises) {
            for (const ex of day.exercises) {
              doc.fontSize(10).fill(charcoal).font('Helvetica')
                .text(`• ${ex.name} — ${ex.sets} × ${ex.reps} (Rest: ${ex.rest})`, 60);
              if (ex.notes) {
                doc.fontSize(8).fill('#888888').text(`  ${ex.notes}`, 70);
              }
            }
          }

          if (day.cooldown) {
            doc.fontSize(9).fill('#666666').font('Helvetica')
              .text(`Cool-down: ${day.cooldown}`, 60);
          }

          doc.moveDown(0.8);

          if (doc.y > doc.page.height - 150) doc.addPage();
        }
      }

      if (wp.rest_days) {
        doc.fontSize(10).fill('#666666').font('Helvetica')
          .text(`Rest Days: ${wp.rest_days.join(', ')}`, 50);
        doc.moveDown(1);
      }
    }

    if (doc.y > doc.page.height - 300) doc.addPage();

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(18).fill(gold).font('Helvetica-Bold').text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);

      if (np.daily_calories) {
        doc.fontSize(12).fill(charcoal).font('Helvetica-Bold')
          .text(`Daily Target: ${np.daily_calories} kcal`, 50);
      }
      if (np.macros) {
        doc.fontSize(10).fill(charcoal).font('Helvetica')
          .text(`Protein: ${np.macros.protein_g}g | Carbs: ${np.macros.carbs_g}g | Fat: ${np.macros.fat_g}g`, 50);
      }
      doc.moveDown(0.8);

      if (np.meal_framework) {
        for (const meal of np.meal_framework) {
          doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
            .text(meal.meal, 50);
          doc.fontSize(10).fill('#444444').font('Helvetica')
            .text(meal.description, 60);
          if (meal.example) {
            doc.fontSize(9).fill('#888888').text(`Example: ${meal.example}`, 60);
          }
          doc.moveDown(0.5);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill(charcoal).font('Helvetica')
          .text(`💧 Hydration: ${np.hydration}`, 50);
      }
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(gold);
    doc.moveDown(0.5);
    doc.fontSize(8).fill('#999999').font('Helvetica')
      .text('Generated by Fitness by Maddy Coaching System. For personal use only.', 50, doc.y, { align: 'center' });

    doc.end();
  });
}
