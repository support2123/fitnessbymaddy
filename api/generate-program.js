const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { PROGRAMS, maskPhone } = require('../lib/constants');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, lead:leads(*)')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();
    const programPrompt = buildProgramPrompt(client, intake, recentCheckins, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: programPrompt }],
      system: `You are a certified fitness program architect for Fitness by Maddy.
You create safe, effective, personalised weekly workout and nutrition plans.
NEVER recommend extreme calorie deficits (<1200 cal for women, <1500 for men).
NEVER recommend banned or unregulated supplements.
NEVER promise specific weight loss timelines.
Always output valid JSON matching the requested schema.`,
    });

    let programData;
    try {
      const textContent = message.content.find(c => c.type === 'text');
      const jsonStr = textContent.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      programData = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[Program] Failed to parse Claude response');
      await notifyMaddy(`Program generation failed for client ${maskPhone(client.phone)} week ${week_no} — Claude output unparseable`);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    if (programData.flagged) {
      await notifyMaddy(`Program flagged for review: ${client.name || maskPhone(client.phone)} week ${week_no} — ${programData.flag_reason}`);
      return res.status(200).json({ ok: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('[Program] Upload error:', uploadError.message);
    }

    const { data: publicUrl } = supabase.storage.from('clients').getPublicUrl(filePath);

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || null,
    });

    if (insertError) {
      console.error('[Program] DB insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = programData.notes || `Week ${week_no} program ready!`;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      contextNote.slice(0, 100),
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: publicUrl?.publicUrl });
  } catch (err) {
    console.error('[Generate Program Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, intake, checkins, weekNo) {
  const profile = [];
  if (intake) {
    profile.push(`Age: ${intake.age || 'unknown'}, Gender: ${intake.gender || 'unknown'}`);
    profile.push(`Height: ${intake.height_cm || '?'}cm, Starting weight: ${intake.weight_kg || '?'}kg`);
    profile.push(`Goal: ${intake.goal || 'general fitness'}`);
    profile.push(`Injuries: ${intake.injuries || 'none reported'}`);
    profile.push(`Medical: ${intake.medical_conditions || 'none'}`);
    profile.push(`Diet: ${intake.diet_preference || 'no preference'}`);
    profile.push(`Experience: ${intake.training_experience || 'unknown'}`);
    profile.push(`Available days: ${intake.available_days || 5}`);
    profile.push(`Equipment: ${intake.equipment || 'full gym'}`);
  }

  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `Generate a personalised Week ${weekNo} program for this client.

CLIENT PROFILE:
Name: ${client.name || 'Client'}
Program: ${PROGRAMS[client.program]?.name || client.program}
${profile.join('\n')}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (first week)'}

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min incline walk"
      }
    ],
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 73,
    "meal_framework": [
      { "meal": "Breakfast", "example": "3 eggs + 2 toast + avocado", "macros": "P:25 C:30 F:20" }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "notes": "One-liner summary of this week's focus and adjustments",
  "flagged": false,
  "flag_reason": ""
}

Rules:
- Adapt based on check-in data (compliance, energy, issues)
- If compliance < 5, simplify the plan
- If energy < 4, reduce volume by 20%
- If issues mention pain, REMOVE exercises for that area and set flagged=true
- Progressive overload from previous weeks
- Keep meals practical and aligned with client's diet preference`;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 70, { align: 'center' });
    doc.fill('#D4AF7A').fontSize(10)
      .text(client.name || 'Client', 50, 92, { align: 'center' });

    let y = 140;

    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold').text('WORKOUT PLAN', 50, y);
    y += 30;

    if (programData.workout_plan?.days) {
      for (const day of programData.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.rect(50, y, doc.page.width - 100, 24).fill('#F0EAE0');
        doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 58, y + 6);
        y += 32;

        for (const ex of day.exercises || []) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
            .text(`• ${ex.name}`, 58, y)
            .text(`${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 280, y);
          if (ex.notes) {
            y += 14;
            doc.fill('#6B6B6B').fontSize(8).text(`  ${ex.notes}`, 70, y);
          }
          y += 18;
        }

        if (day.cardio) {
          doc.fill('#B8965A').fontSize(9).font('Helvetica-Bold')
            .text(`Cardio: ${day.cardio}`, 58, y);
          y += 20;
        }
        y += 10;
      }
    }

    doc.addPage();
    y = 50;

    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold').text('NUTRITION PLAN', 50, y);
    y += 30;

    const np = programData.nutrition_plan;
    if (np) {
      doc.rect(50, y, doc.page.width - 100, 50).fill('#2C2C2C');
      doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold')
        .text(`${np.calories} KCAL  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fat_g}g`, 50, y + 18, { align: 'center' });
      y += 70;

      if (np.meal_framework) {
        for (const meal of np.meal_framework) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold').text(meal.meal, 58, y);
          y += 16;
          doc.fill('#6B6B6B').fontSize(10).font('Helvetica').text(meal.example, 58, y);
          if (meal.macros) {
            doc.fill('#B8965A').fontSize(8).text(meal.macros, 400, y);
          }
          y += 20;
        }
      }

      if (np.supplements?.length) {
        y += 10;
        doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold').text('Supplements:', 58, y);
        y += 16;
        doc.fill('#6B6B6B').fontSize(10).font('Helvetica').text(np.supplements.join(', '), 58, y);
        y += 20;
      }

      if (np.hydration) {
        doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold').text('Hydration:', 58, y);
        y += 16;
        doc.fill('#6B6B6B').fontSize(10).font('Helvetica').text(np.hydration, 58, y);
      }
    }

    if (programData.notes) {
      doc.addPage();
      doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold').text("COACH'S NOTE", 50, 50);
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica').text(programData.notes, 50, 75, { width: doc.page.width - 100 });
    }

    doc.end();
  });
}
