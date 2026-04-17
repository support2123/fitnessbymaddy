const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone, MADDY_PHONE } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i,
  /extreme\s*cut/i,
  /fasting.*72\s*h/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('phone', client.phone)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness coach and nutritionist creating a personalized weekly program.
Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 130,
    "carbs_g": 200,
    "fats_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." },
      ...
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coach note for the client"
}
Rules:
- Never go below 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- Account for injuries and medical conditions
- Progressive overload week-over-week
- Be specific with exercise names, sets, reps`;

    const userPrompt = buildClientPrompt(client, checkins, intakeForm, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawOutput = response.content[0].text;
    let programData;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const outputStr = JSON.stringify(programData);
    if (RISKY_PATTERNS.some(p => p.test(outputStr))) {
      await sendWhatsApp({
        phone: MADDY_PHONE,
        templateName: 'escalation_alert',
        params: [maskPhone(client.phone), 'Risky program flagged', `Week ${week_no} program flagged for review`],
        body: `HALT — Program flagged for review\nClient: ${maskPhone(client.phone)}\nWeek: ${week_no}\nReason: Content triggered safety filter`
      });
      return res.status(200).json({ ok: true, action: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || '';

    const { error: progErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes
    });

    if (progErr) throw progErr;

    const contextNote = programData.notes || `Week ${week_no} program is ready!`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [client.name || 'there', String(week_no), contextNote],
      body: `Hey ${client.name || 'there'}! Week ${week_no} program ready hai. ${contextNote}`,
      mediaUrl: pdfUrl
    });

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function buildClientPrompt(client, checkins, intake, weekNo) {
  let prompt = `Create Week ${weekNo} program for:\n`;
  prompt += `- Name: ${client.name || 'Client'}\n`;
  prompt += `- Program: ${client.program}\n`;

  if (intake) {
    prompt += `- Age: ${intake.age || 'unknown'}\n`;
    prompt += `- Gender: ${intake.gender || 'unknown'}\n`;
    prompt += `- Goal: ${intake.goal || 'general fitness'}\n`;
    prompt += `- Injuries: ${intake.injuries || 'none reported'}\n`;
    prompt += `- Diet preference: ${intake.diet_preference || 'no preference'}\n`;
    prompt += `- Schedule: ${intake.schedule || 'flexible'}\n`;
    prompt += `- Medical conditions: ${intake.medical_conditions || 'none'}\n`;
    prompt += `- Experience: ${intake.experience_level || 'beginner'}\n`;
    prompt += `- Current weight: ${intake.current_weight || 'unknown'}kg\n`;
    prompt += `- Target weight: ${intake.target_weight || 'unknown'}kg\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const ci of checkins) {
      prompt += `  Week ${ci.week_no}: weight=${ci.weight}kg, waist=${ci.waist}cm, `;
      prompt += `compliance=${ci.compliance_score}/10, energy=${ci.energy}/10`;
      if (ci.issues) prompt += `, issues: ${ci.issues}`;
      prompt += '\n';
    }
  }

  prompt += `\nAdjust difficulty and nutrition based on progress. Week ${weekNo} of ${client.program === '12wk' ? 12 : 6}.`;
  return prompt;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 40, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF').text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 40, 75, { align: 'center' });

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    if (programData.workout_plan?.days) {
      doc.fontSize(18).fillColor('#B8965A').text('WORKOUT PLAN');
      doc.moveDown(0.5);

      for (const day of programData.workout_plan.days) {
        doc.fontSize(13).fillColor('#2C2C2C').text(`${day.day} — ${day.focus}`, { underline: true });
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fillColor('#444444')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  |  ' + ex.notes : ''}`);
          }
        }
        doc.moveDown(0.5);
      }

      if (programData.workout_plan.cardio) {
        const c = programData.workout_plan.cardio;
        doc.fontSize(11).fillColor('#2C2C2C').text(`Cardio: ${c.type} — ${c.frequency}, ${c.duration}`);
      }
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 50).fill('#2C2C2C');
    doc.fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN', 40, 15, { align: 'center' });
    doc.moveDown(2);
    doc.fillColor('#2C2C2C');

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(12).text(`Daily Targets: ${np.calories} kcal  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fats_g}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).fillColor('#B8965A').text(meal.meal);
          doc.fontSize(10).fillColor('#444444');
          if (Array.isArray(meal.options)) {
            for (const opt of meal.options) {
              doc.text(`  • ${opt}`);
            }
          }
          if (meal.macros) doc.text(`  Macros: ${meal.macros}`);
          doc.moveDown(0.3);
        }
      }

      if (np.supplements?.length) {
        doc.moveDown(0.5).fontSize(11).fillColor('#2C2C2C').text('Supplements: ' + np.supplements.join(', '));
      }
      if (np.hydration) {
        doc.text('Hydration: ' + np.hydration);
      }
    }

    if (programData.notes) {
      doc.moveDown(1).fontSize(11).fillColor('#B8965A').text("Coach's Note:");
      doc.fontSize(10).fillColor('#2C2C2C').text(programData.notes);
    }

    doc.moveDown(2).fontSize(8).fillColor('#999999').text('FitnessByMaddy — This program is personalized. Do not share.', { align: 'center' });

    doc.end();
  });
}
