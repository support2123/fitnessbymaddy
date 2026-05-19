const { getClient } = require('../lib/supabase');
const { sendTextMessage } = require('../lib/whatsapp');
const { logMessage, notifyMaddy } = require('../lib/escalation');
const { maskPhone, PROGRAM_NAMES } = require('../lib/utils');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getClient();

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = null;
    if (intakeMsg?.body) {
      try { intakeData = JSON.parse(intakeMsg.body); } catch {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Design evidence-based, progressive training and nutrition plans.

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 kcal women, 1500 kcal men)
- Never recommend banned or dangerous substances
- Never promise specific timelines for results
- Always include rest days and deload guidance
- Account for injuries and medical conditions
- Be specific: exact exercises, sets, reps, rest periods, meal portions

Output valid JSON with two keys: "workout_plan" and "nutrition_plan".
workout_plan: { days: [{ day: string, focus: string, exercises: [{ name, sets, reps, rest, notes }] }], cardio: string, deload_notes: string }
nutrition_plan: { daily_calories: number, protein_g: number, carbs_g: number, fat_g: number, meals: [{ meal: string, options: [string] }], supplements: [string], hydration: string }`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Started: ${client.program_started_at}
${intakeData ? `- Age: ${intakeData.age || 'N/A'}
- Gender: ${intakeData.gender || 'N/A'}
- Height: ${intakeData.height || 'N/A'}
- Current Weight: ${intakeData.weight || 'N/A'}
- Goal: ${intakeData.goal || 'N/A'}
- Injuries: ${intakeData.injuries || 'None'}
- Medical: ${intakeData.medical_conditions || 'None'}
- Diet Preference: ${intakeData.diet_preference || 'No preference'}
- Equipment: ${intakeData.equipment_access || 'Full gym'}
- Schedule: ${intakeData.schedule || 'Flexible'}` : ''}

${recentCheckins?.length ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10${c.issues ? `, Issues: ${c.issues}` : ''}`).join('\n')}` : 'No previous check-ins (first week).'}

Design a progressive, periodized plan for Week ${week_no}. If check-in data shows declining compliance or energy, adjust volume/intensity accordingly.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      await notifyMaddy(
        'Program generation parse error',
        `Client: ${maskPhone(client.phone)}, Week ${week_no} — Could not parse Claude response`
      );
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const safetyFlags = checkSafety(programData);
    if (safetyFlags.length > 0) {
      await notifyMaddy(
        'Program safety flag',
        `Client: ${maskPhone(client.phone)}, Week ${week_no} — Flags: ${safetyFlags.join(', ')}`
      );
      return res.status(200).json({
        success: false,
        reason: 'Safety review required',
        flags: safetyFlags,
      });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: `Generated for Week ${week_no}`,
    });

    if (insertErr) {
      console.error('Program record insert error:', insertErr.message);
    }

    const contextNote = week_no === 1
      ? `Here's your Week 1 program! Start strong 💪`
      : `Week ${week_no} is ready! ${getWeekContext(recentCheckins)}`;

    const msg = `📋 *Week ${week_no} Program Ready*\n\n${contextNote}\n\n${publicUrl?.publicUrl || 'PDF attached — check your email.'}`;

    await sendTextMessage(client.phone, msg);
    await logMessage(db, client.phone, 'out', msg, 'weekly_program');

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, program_id: filePath });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function checkSafety(programData) {
  const flags = [];
  const np = programData.nutrition_plan;
  if (np?.daily_calories && np.daily_calories < 1200) {
    flags.push('Extreme calorie deficit (<1200 kcal)');
  }
  const bannedTerms = ['steroid', 'clenbuterol', 'dnp', 'ephedra', 'sarm'];
  const text = JSON.stringify(programData).toLowerCase();
  for (const term of bannedTerms) {
    if (text.includes(term)) {
      flags.push(`Banned substance reference: ${term}`);
    }
  }
  return flags;
}

function getWeekContext(checkins) {
  if (!checkins?.length) return 'Keep pushing!';
  const latest = checkins[0];
  if (latest.compliance_score >= 8) return 'Great compliance last week — stepping it up! 🔥';
  if (latest.compliance_score <= 4) return 'Adjusted volume to help you stay consistent.';
  return 'Solid progress — let\'s keep the momentum! 💪';
}

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fillColor('#B8965A')
       .fontSize(10)
       .font('Helvetica')
       .text('FITNESS BY MADDY', 50, 40, { characterSpacing: 4 });

    doc.fillColor('#B8965A')
       .moveTo(50, 60)
       .lineTo(doc.page.width - 50, 60)
       .lineWidth(0.5)
       .stroke('#B8965A');

    doc.fillColor('#FFFFFF')
       .fontSize(32)
       .font('Helvetica-Bold')
       .text(`WEEK ${weekNo}`, 50, 80);

    doc.fillColor('#B8965A')
       .fontSize(14)
       .font('Helvetica')
       .text(`${client.name || 'Client'} — ${PROGRAM_NAMES[client.program] || client.program}`, 50, 120);

    let y = 160;

    if (programData.workout_plan?.days) {
      doc.fillColor('#B8965A')
         .fontSize(18)
         .font('Helvetica-Bold')
         .text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of programData.workout_plan.days) {
        if (y > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
          y = 50;
        }

        doc.fillColor('#FFFFFF')
           .fontSize(13)
           .font('Helvetica-Bold')
           .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) {
              doc.addPage();
              doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
              y = 50;
            }
            doc.fillColor('#CCCCCC')
               .fontSize(10)
               .font('Helvetica')
               .text(`  • ${ex.name}: ${ex.sets}×${ex.reps} (Rest: ${ex.rest})${ex.notes ? ' — ' + ex.notes : ''}`, 60, y, { width: 480 });
            y += 16;
          }
        }
        y += 10;
      }
    }

    if (programData.nutrition_plan) {
      if (y > 550) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
        y = 50;
      }

      y += 20;
      doc.fillColor('#B8965A')
         .fontSize(18)
         .font('Helvetica-Bold')
         .text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = programData.nutrition_plan;
      doc.fillColor('#FFFFFF')
         .fontSize(11)
         .font('Helvetica')
         .text(`Daily Target: ${np.daily_calories} kcal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`, 50, y);
      y += 25;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) {
            doc.addPage();
            doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
            y = 50;
          }
          doc.fillColor('#B8965A')
             .fontSize(11)
             .font('Helvetica-Bold')
             .text(meal.meal, 50, y);
          y += 16;

          if (meal.options) {
            for (const opt of meal.options) {
              doc.fillColor('#CCCCCC')
                 .fontSize(10)
                 .font('Helvetica')
                 .text(`  • ${opt}`, 60, y, { width: 480 });
              y += 14;
            }
          }
          y += 8;
        }
      }
    }

    doc.fillColor('#B8965A')
       .fontSize(8)
       .font('Helvetica')
       .text('© Fitness by Maddy | fitnessbymaddy.com | This program is personalised — do not share.',
         50, doc.page.height - 40, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}
