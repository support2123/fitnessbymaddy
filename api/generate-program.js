const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, parseBody, cors } = require('../lib/utils');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 1000 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for weight loss'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const claude = new Anthropic();

    const checkinSummary = (recentCheckins || []).map(c =>
      `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    ).join('\n');

    const prompt = `You are a certified fitness program architect for FitnessByMaddy.

Client profile:
- Name: ${client.name || 'Client'}
- Program: 12-Week Custom Flagship
- Current week: ${week_no} of 12

Recent check-in data:
${checkinSummary || 'No previous check-ins (Week 1)'}

Generate a complete weekly program in JSON format with these exact keys:
{
  "workout_plan": {
    "overview": "brief weekly focus",
    "days": [
      {
        "day": "Monday",
        "focus": "muscle group",
        "exercises": [
          {"name": "exercise", "sets": 3, "reps": "8-12", "rest": "90s", "notes": ""}
        ],
        "cardio": "optional cardio recommendation"
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meal_timing": ["meal 1 description", "meal 2 description"],
    "hydration": "water recommendation",
    "supplements": ["if applicable"]
  },
  "notes": "personalized coaching note for the week"
}

Rules:
- Be specific with exercises, sets, reps, and rest periods
- Adjust based on check-in data (compliance, energy, issues)
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Include rest days (at least 1-2 per week)
- Keep it realistic and sustainable

Return ONLY the JSON object, no markdown fences.`;

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawOutput = response.content[0].text;

    if (hasSafetyIssue(rawOutput)) {
      await notifyMaddy(
        'Program Safety Flag',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReason: Unsafe content detected in generated program. Manual review required.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flag', needs_review: true });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse program JSON from Claude response');
      }
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError);
    }

    const { data: publicUrl } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const { data: program, error: insertError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: publicUrl?.publicUrl || pdfPath,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.notes
      })
      .select()
      .single();

    if (insertError) {
      console.error('Program insert error:', insertError);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const waResult = await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.notes || 'Your new program is ready!'
    ], true);

    if (waResult.ok) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({
      ok: true,
      program_id: program.id,
      pdf_url: publicUrl?.publicUrl || pdfPath
    });
  } catch (err) {
    console.error('Generate program error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(client, weekNo, plan) {
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
      .text(`${client.name || 'Client'} | 12-Week Custom Flagship`, 50, 92, { align: 'center' });

    doc.moveDown(4);

    doc.fill('#B8965A').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN');
    doc.moveDown(0.5);

    if (plan.workout_plan?.overview) {
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica')
        .text(plan.workout_plan.overview);
      doc.moveDown(0.5);
    }

    if (plan.workout_plan?.days) {
      for (const day of plan.workout_plan.days) {
        doc.fill('#2C2C2C').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
              .text(`  ${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`);
          }
        }
        if (day.cardio) {
          doc.fill('#B8965A').fontSize(10).font('Helvetica')
            .text(`  Cardio: ${day.cardio}`);
        }
        doc.moveDown(0.5);

        if (doc.y > 700) doc.addPage();
      }
    }

    if (doc.y > 500) doc.addPage();

    doc.fill('#B8965A').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN');
    doc.moveDown(0.5);

    if (plan.nutrition_plan) {
      const np = plan.nutrition_plan;
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold')
        .text('Daily Targets:');
      doc.font('Helvetica').fontSize(10).fill('#6B6B6B')
        .text(`  Calories: ${np.daily_calories} kcal`)
        .text(`  Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fats: ${np.fats_g}g`);

      if (np.hydration) {
        doc.text(`  Hydration: ${np.hydration}`);
      }
      doc.moveDown(0.5);

      if (np.meal_timing?.length) {
        doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold')
          .text('Meal Plan:');
        np.meal_timing.forEach((meal, i) => {
          doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
            .text(`  Meal ${i + 1}: ${meal}`);
        });
        doc.moveDown(0.5);
      }

      if (np.supplements?.length) {
        doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold')
          .text('Supplements:');
        np.supplements.forEach(s => {
          doc.fill('#6B6B6B').fontSize(10).font('Helvetica')
            .text(`  - ${s}`);
        });
      }
    }

    doc.moveDown(1);
    if (plan.notes) {
      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold')
        .text('COACH\'S NOTE');
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica')
        .text(plan.notes);
    }

    const bottomY = doc.page.height - 40;
    doc.fill('#C8B89A').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, bottomY, { align: 'center' });

    doc.end();
  });
}
