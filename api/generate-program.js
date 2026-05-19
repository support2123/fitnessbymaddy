const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'rapid water cut'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  try {
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

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, recentCheckins, lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let programData;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program from Claude' });
    }

    const contentStr = JSON.stringify(programData).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (contentStr.includes(flag)) {
        await supabase.from('escalations').insert({
          phone: client.phone,
          reason: `Safety flag in generated program: "${flag}"`,
          message_body: `Week ${week_no} program for ${client.name} contained flagged content`
        });
        return res.status(200).json({ status: 'flagged_for_review', flag });
      }
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    const pdfUrl = uploadErr
      ? null
      : supabase.storage.from('client-files').getPublicUrl(pdfPath).data.publicUrl;

    const { data: program, error } = await supabase.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || programData.workouts || {},
      nutrition_plan: programData.nutrition_plan || programData.nutrition || {},
      notes: programData.notes || programData.coach_notes || null
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (pdfUrl) {
      await sendTemplate(client.phone, 'weekly_program', [
        client.name || 'there',
        String(week_no),
        programData.notes || 'Your updated plan is ready!'
      ]);

      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    return res.status(200).json({
      success: true,
      program_id: program?.id,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are an expert fitness program architect for FitnessByMaddy, a premium online coaching brand.

Generate a Week ${weekNo} training and nutrition program for the following client.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Age: ${client.age || 'unknown'}
- Goal: ${client.goal || 'general fitness'}
- Injuries/Limitations: ${client.injuries || 'none reported'}
- Diet Preference: ${client.diet_pref || 'flexible'}
- Schedule: ${client.schedule || 'flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No check-in data yet (first week)'}

${lastProgram ? `LAST WEEK'S FOCUS: ${lastProgram.notes || 'Standard progression'}` : ''}

RULES:
- Calorie recommendations must be realistic (minimum 1200 for women, 1500 for men)
- No banned substances, no extreme protocols
- Account for any injuries or limitations
- Progressive overload from last week if applicable
- Include rest days
- Nutrition must include protein targets

Return a JSON object with this exact structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }] },
      ...
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "cardio": { "frequency": "3x/week", "type": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 60,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "...", "macros": "..." },
      ...
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "One-liner context note for WhatsApp delivery"
}
\`\`\``;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');
    doc.fontSize(28).fill('#D4AF7A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#888888').text(`${client.name || 'Client'} | ${client.program}`, 50, 95, { align: 'center' });

    doc.moveDown(3);

    if (programData.workout_plan?.days) {
      doc.fontSize(18).fill('#D4AF7A').text('WORKOUT PLAN', { underline: true });
      doc.moveDown(0.5);

      for (const day of programData.workout_plan.days) {
        doc.fontSize(13).fill('#1a1a1a').text(`${day.day} — ${day.focus}`);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#444444')
              .text(`  • ${ex.name}: ${ex.sets} x ${ex.reps} (Rest: ${ex.rest || '60s'})${ex.notes ? ' — ' + ex.notes : ''}`);
          }
        }
        doc.moveDown(0.3);
      }

      if (programData.workout_plan.cardio) {
        doc.moveDown(0.3);
        const cardio = programData.workout_plan.cardio;
        doc.fontSize(11).fill('#1a1a1a').text(`Cardio: ${cardio.frequency} | ${cardio.type} | ${cardio.duration}`);
      }
    }

    doc.moveDown(1);

    if (programData.nutrition_plan) {
      const np = programData.nutrition_plan;
      doc.fontSize(18).fill('#D4AF7A').text('NUTRITION PLAN', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).fill('#1a1a1a')
        .text(`Daily Targets: ${np.calories} kcal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`);
      doc.moveDown(0.3);

      if (np.meal_framework) {
        for (const meal of np.meal_framework) {
          doc.fontSize(10).fill('#444444')
            .text(`  ${meal.meal}: ${meal.suggestion}${meal.macros ? ' (' + meal.macros + ')' : ''}`);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.3);
        doc.fontSize(10).fill('#444444').text(`Hydration: ${np.hydration}`);
      }
    }

    if (programData.notes) {
      doc.moveDown(1.5);
      doc.fontSize(10).fill('#888888').text(`Coach's Note: ${programData.notes}`);
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#CCCCCC').text('Generated by FitnessByMaddy Coaching System', { align: 'center' });

    doc.end();
  });
}
