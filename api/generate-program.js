const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, PROGRAM_NAMES } = require('./_lib/utils');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
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
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const claudePrompt = buildPrompt(client, recentCheckins || [], prevPrograms?.[0] || null, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: claudePrompt }],
      system: `You are "Program Architect" for FitnessByMaddy, an elite online coaching brand. You generate weekly personalised workout and nutrition plans in JSON format. Be evidence-based, warm, and realistic. Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men), banned substances, or unrealistic timelines. Output ONLY valid JSON with keys: workout_plan, nutrition_plan, notes.`,
    });

    const rawOutput = response.content[0]?.text || '';

    const safetyIssue = SAFETY_FLAGS.find(flag =>
      rawOutput.toLowerCase().includes(flag)
    );
    if (safetyIssue) {
      await notifyMaddy(
        'Program generation safety flag',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nFlag: "${safetyIssue}" detected in output.\n\nPlease review before sending.`
      );
      return res.status(200).json({
        ok: false,
        flagged: true,
        reason: safetyIssue,
        client_id,
        week_no,
      });
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch {
      console.error('[generate] Failed to parse Claude output as JSON');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const filePath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('[generate] PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const { data: program, error: insertError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: publicUrl?.publicUrl || filePath,
        workout_plan: parsed.workout_plan || null,
        nutrition_plan: parsed.nutrition_plan || null,
        notes: parsed.notes || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[generate] Program insert error:', insertError.message);
      return res.status(500).json({ error: 'DB error' });
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      week_no.toString(),
      parsed.notes || 'Your new program is ready!',
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      ok: true,
      program_id: program.id,
      pdf_url: publicUrl?.publicUrl || filePath,
    });
  } catch (err) {
    console.error('[generate-program] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Unknown'}\n`;
  prompt += `Program: ${PROGRAM_NAMES[client.program] || client.program}\n`;
  prompt += `Started: ${client.program_started_at}\n\n`;

  if (checkins.length > 0) {
    prompt += `Recent check-ins:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: "${c.issues}"`;
      prompt += '\n';
    }
    prompt += '\n';
  }

  if (prevProgram) {
    prompt += `Previous week focus: ${prevProgram.notes || 'N/A'}\n\n`;
  }

  prompt += `Return JSON with exactly these keys:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "..." }
        ]
      }
    ],
    "cardio": "...",
    "rest_days": ["...", "..."]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 240,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] },
      { "meal": "Lunch", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-liner context for the client about this week's focus"
}`;

  return prompt;
}

function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#C8B89A')
      .text(`${client.name || 'Client'} | ${PROGRAM_NAMES[client.program] || client.program}`, 50, 95, { align: 'center' });

    doc.moveDown(3);

    if (program.notes) {
      doc.fontSize(11).fill('#6B6B6B')
        .text(program.notes, 50, doc.y, { width: 495 });
      doc.moveDown(1.5);
    }

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN');
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 100, 2).fill('#B8965A');
    doc.moveDown(1);

    if (program.workout_plan?.days) {
      for (const day of program.workout_plan.days) {
        if (doc.y > 700) doc.addPage();

        doc.fontSize(13).fill('#2C2C2C')
          .text(`${day.day} — ${day.focus || ''}`, 50, doc.y);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  •  ${ex.name}  |  ${ex.sets} × ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60, doc.y, { width: 480 });
            if (ex.notes) {
              doc.fontSize(9).fill('#999999')
                .text(`     ${ex.notes}`, 70, doc.y, { width: 470 });
            }
          }
        }
        doc.moveDown(0.8);
      }
    }

    if (program.workout_plan?.cardio) {
      doc.fontSize(10).fill('#6B6B6B')
        .text(`Cardio: ${program.workout_plan.cardio}`, 50, doc.y);
      doc.moveDown(0.5);
    }

    if (doc.y > 600) doc.addPage();
    doc.moveDown(1.5);
    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN');
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 100, 2).fill('#B8965A');
    doc.moveDown(1);

    if (program.nutrition_plan) {
      const np = program.nutrition_plan;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Targets: ${np.calories || '—'} kcal  |  P: ${np.protein_g || '—'}g  |  C: ${np.carbs_g || '—'}g  |  F: ${np.fat_g || '—'}g`);
      doc.moveDown(1);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(12).fill('#2C2C2C').text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B')
                .text(`  •  ${opt}`, 60, doc.y, { width: 480 });
            }
          }
          doc.moveDown(0.5);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${np.hydration}`);
      }
    }

    doc.moveDown(2);
    doc.rect(50, doc.y, 495, 1).fill('#E8E3DC');
    doc.moveDown(0.5);
    doc.fontSize(8).fill('#C8B89A')
      .text('© Fitness by Maddy — fitnessbymaddy.com', 50, doc.y, { align: 'center' });

    doc.end();
  });
}
