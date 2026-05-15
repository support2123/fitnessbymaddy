const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { maskPhone, jsonResponse, PROGRAM_NAMES } = require('./_lib/utils');

const SYSTEM_PROMPT = `You are a world-class fitness coach and program architect for FitnessByMaddy.
Create a detailed, safe, science-backed weekly program based on the client data provided.

Output valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min light cardio + dynamic stretches",
        "cooldown": "5 min static stretches"
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "cardio": { "type": "LISS", "frequency": "3x/week", "duration": "25 min" }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1 description", "Option 2 description"] }
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein post-workout", "Creatine 5g daily"]
  },
  "weekly_focus": "Brief motivational note about this week's priorities",
  "notes": "Any special considerations"
}

SAFETY RULES:
- Never prescribe fewer than 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme supplementation
- Always include rest days
- If the client reports pain or injury, note it and recommend medical consultation
- Be conservative with progressive overload for beginners`;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return jsonResponse(res, 400, { error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return jsonResponse(res, 404, { error: 'Client not found' });

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

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Unknown'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Conditions: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No restriction'}
- Schedule: ${client.schedule || 'Flexible'}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : '  No previous check-ins (Week 1)'}

PREVIOUS PROGRAM NOTES:
${lastProgram ? lastProgram.notes || 'None' : 'First program — no prior data'}

Please create an appropriate Week ${week_no} program. Adjust intensity based on check-in data. If compliance or energy is low, reduce volume slightly and add motivational notes.`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Program] Claude returned non-JSON response');
      return jsonResponse(res, 500, { error: 'Invalid program output' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const safetyChecks = [];
    if (programData.nutrition_plan?.calories < 1200) {
      safetyChecks.push('Calories below 1200 — flagged for review');
    }
    if (programData.workout_plan?.rest_days?.length === 0) {
      safetyChecks.push('No rest days prescribed');
    }

    if (safetyChecks.length > 0) {
      await db.from('escalations').insert({
        phone: client.phone,
        reason: 'program_safety_flag',
        message_body: `Week ${week_no}: ${safetyChecks.join('; ')}`
      });
      const { notifyMaddy } = require('./_lib/whatsapp');
      await notifyMaddy('Program Safety Flag', `Client: ${client.name}\n${safetyChecks.join('\n')}`);
      return jsonResponse(res, 200, { ok: false, flagged: true, issues: safetyChecks });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('[Program] PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(filePath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || programData.weekly_focus
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.weekly_focus || 'Your new program is ready!'
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    console.log(`[Program] Generated Week ${week_no} for ${maskPhone(client.phone)}`);
    return jsonResponse(res, 200, { ok: true, program_id: program?.id });
  } catch (err) {
    console.error('[Program Generation Error]', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
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
    doc.fill('#FFFFFF').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 3 });
    doc.fill(gold).fontSize(14).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { characterSpacing: 2 });

    doc.fill(charcoal).fontSize(11).font('Helvetica')
      .text(`Client: ${client.name || 'Client'}`, 50, 140)
      .text(`Program: ${PROGRAM_NAMES[client.program] || client.program}`, 50, 158)
      .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 176);

    doc.moveTo(50, 200).lineTo(doc.page.width - 50, 200).stroke(gold);

    let y = 220;

    if (programData.weekly_focus) {
      doc.fill(gold).fontSize(10).font('Helvetica-Bold')
        .text('THIS WEEK\'S FOCUS', 50, y, { characterSpacing: 1 });
      y += 18;
      doc.fill(charcoal).fontSize(10).font('Helvetica')
        .text(programData.weekly_focus, 50, y, { width: doc.page.width - 100 });
      y += doc.heightOfString(programData.weekly_focus, { width: doc.page.width - 100 }) + 20;
    }

    if (programData.workout_plan?.days) {
      doc.fill(gold).fontSize(12).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50, y, { characterSpacing: 2 });
      y += 25;

      for (const day of programData.workout_plan.days) {
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 50;
        }

        doc.fill(charcoal).fontSize(11).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 18;

        if (day.warmup) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Warm-up: ${day.warmup}`, 60, y);
          y += 14;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > doc.page.height - 60) {
              doc.addPage();
              y = 50;
            }
            doc.fill(charcoal).fontSize(9).font('Helvetica')
              .text(`• ${ex.name} — ${ex.sets} x ${ex.reps} (Rest: ${ex.rest})`, 60, y);
            y += 13;
            if (ex.notes) {
              doc.fill('#6B6B6B').fontSize(8).font('Helvetica')
                .text(`  ${ex.notes}`, 70, y);
              y += 12;
            }
          }
        }
        y += 10;
      }
    }

    if (y > doc.page.height - 200) {
      doc.addPage();
      y = 50;
    }

    if (programData.nutrition_plan) {
      y += 10;
      doc.fill(gold).fontSize(12).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50, y, { characterSpacing: 2 });
      y += 25;

      const np = programData.nutrition_plan;
      doc.fill(charcoal).fontSize(10).font('Helvetica-Bold')
        .text('Daily Targets:', 50, y);
      y += 16;
      doc.fill(charcoal).fontSize(9).font('Helvetica')
        .text(`Calories: ${np.calories} kcal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`, 60, y);
      y += 20;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > doc.page.height - 60) {
            doc.addPage();
            y = 50;
          }
          doc.fill(charcoal).fontSize(10).font('Helvetica-Bold')
            .text(meal.meal, 60, y);
          y += 14;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
                .text(`• ${opt}`, 70, y, { width: doc.page.width - 130 });
              y += doc.heightOfString(`• ${opt}`, { width: doc.page.width - 130 }) + 4;
            }
          }
          y += 6;
        }
      }

      if (np.hydration) {
        y += 6;
        doc.fill(charcoal).fontSize(9).font('Helvetica')
          .text(`Hydration: ${np.hydration}`, 60, y);
        y += 14;
      }

      if (np.supplements && np.supplements.length > 0) {
        doc.fill(charcoal).fontSize(9).font('Helvetica')
          .text(`Supplements: ${np.supplements.join(', ')}`, 60, y, { width: doc.page.width - 130 });
      }
    }

    const footerY = doc.page.height - 40;
    doc.moveTo(50, footerY - 10).lineTo(doc.page.width - 50, footerY - 10).stroke(gold);
    doc.fill('#6B6B6B').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | This program is for educational purposes. Consult a doctor before starting any fitness program.', 50, footerY, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}
