const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const RISKY_KEYWORDS = [
  'below 1000 calories', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroids', 'sarms',
  'lose 10kg in 1 week', 'crash diet',
];

function hasDangerousContent(text) {
  const lower = text.toLowerCase();
  return RISKY_KEYWORDS.some(kw => lower.includes(kw));
}

async function generateProgramPlan(clientData, checkins) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Design weekly training and nutrition plans that are:
- Evidence-based and progressive
- Tailored to the client's current metrics, goals, and feedback
- Safe (never recommend extreme calorie deficits, banned substances, or unrealistic timelines)
- Practical for the client's available equipment and schedule

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [{"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}]}],
    "cardio": {"type": "...", "frequency": "...", "duration": "..."},
    "deload_notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meal_timing": ["..."],
    "hydration": "...",
    "supplements": ["..."],
    "notes": "..."
  },
  "coach_note": "One-liner context for the client"
}`;

  const userPrompt = `Client profile:
${JSON.stringify(clientData, null, 2)}

Recent check-ins (last 2 weeks):
${JSON.stringify(checkins, null, 2)}

Generate the next week's program. Adjust based on compliance, energy levels, and any reported issues.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text;

  if (hasDangerousContent(text)) {
    throw new Error('SAFETY_FLAG: Generated content contains risky recommendations');
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse program JSON');

  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(program, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 40);

    doc.fill('#ffffff').fontSize(28).font('Helvetica-Bold')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 80);

    doc.fill('#B8965A').fontSize(12).font('Helvetica')
      .text(clientName || 'Client', 50, 115);

    let y = 160;

    doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (program.workout_plan && program.workout_plan.days) {
      for (const day of program.workout_plan.days) {
        if (y > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }

        doc.fill('#ffffff').fontSize(11).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 18;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
            doc.fill('#cccccc').fontSize(9).font('Helvetica')
              .text(`• ${ex.name} — ${ex.sets}x${ex.reps} (rest ${ex.rest})`, 70, y);
            y += 14;
          }
        }
        y += 10;
      }
    }

    y += 20;
    if (y > 650) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }

    doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 25;

    if (program.nutrition_plan) {
      const np = program.nutrition_plan;
      doc.fill('#ffffff').fontSize(10).font('Helvetica')
        .text(`Calories: ${np.calories} kcal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`, 50, y);
      y += 20;

      if (np.meal_timing) {
        for (const meal of np.meal_timing) {
          doc.fill('#cccccc').fontSize(9).font('Helvetica').text(`• ${meal}`, 70, y);
          y += 14;
        }
      }

      y += 15;
      if (np.hydration) {
        doc.fill('#cccccc').fontSize(9).text(`Hydration: ${np.hydration}`, 50, y);
        y += 14;
      }
    }

    if (program.coach_note) {
      y += 20;
      doc.fill('#B8965A').fontSize(9).font('Helvetica-Bold')
        .text('COACH NOTE:', 50, y);
      y += 14;
      doc.fill('#ffffff').fontSize(9).font('Helvetica')
        .text(program.coach_note, 50, y, { width: 500 });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('*, intake_responses:intake_responses(lead_id:lead_id)')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: intake } = await supabase
      .from('intake_responses')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientData = {
      name: client.name,
      program: client.program,
      week: week_no,
      started: client.program_started_at,
      intake: intake || {},
    };

    let programPlan;
    try {
      programPlan = await generateProgramPlan(clientData, recentCheckins || []);
    } catch (err) {
      if (err.message.startsWith('SAFETY_FLAG')) {
        const { escalateToMaddy } = require('./lib/escalation');
        await escalateToMaddy('unsafe_program_content', {
          phone: client.phone,
          message: `Week ${week_no} program flagged for safety review`,
        });
        return res.status(200).json({ flagged: true, reason: err.message });
      }
      throw err;
    }

    const pdfBuffer = await generatePDF(programPlan, client.name, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData.publicUrl;

    const { data: program, error: insertError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: programPlan.workout_plan,
        nutrition_plan: programPlan.nutrition_plan,
        notes: programPlan.coach_note,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const sendResult = await sendWhatsApp(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(week_no), programPlan.coach_note || ''],
      pdfUrl
    );

    if (sendResult.sent) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
