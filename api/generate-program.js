const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { createEscalation } = require('../lib/escalation');
const { json, cors } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'very low calorie', 'below 1000', 'below 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'crash diet', 'water fast',
];

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return json(res, { error: 'client_id and week_no required' }, 400);
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return json(res, { error: 'Client not found' }, 404);

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, a premium women's fitness coaching brand. You design science-backed, progressive training and nutrition plans.

Rules:
- NEVER prescribe below 1200 calories for any client
- NEVER recommend banned substances, fat burners, or extreme protocols
- Always prioritize safety and sustainability
- Include warm-up and cool-down in every workout
- Factor in reported injuries, energy levels, and compliance
- Be warm and encouraging in tone — never bro-sciency
- Output must be valid JSON`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${client.goal || 'general fitness'}
- Age: ${client.age || 'not specified'}
- Injuries/Limitations: ${client.injuries || 'none reported'}
- Diet Preference: ${client.diet_pref || 'no preference'}
- Schedule: ${client.schedule || 'flexible'}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map((c) => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')
  : 'No check-ins yet (Week 1)'}

${prevProgram ? `PREVIOUS WEEK PLAN NOTES: ${prevProgram.notes || 'none'}` : ''}

Return a JSON object with exactly this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Strength",
        "warmup": "5 min band pull-aparts, arm circles",
        "exercises": [
          { "name": "Dumbbell Bench Press", "sets": 3, "reps": "10-12", "rest": "90s", "notes": "" }
        ],
        "cooldown": "5 min stretching"
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "weekly_notes": ""
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 130,
    "carbs_g": 200,
    "fat_g": 65,
    "meals": [
      { "meal": "Breakfast", "example": "Oats with protein powder, berries, and almond butter" }
    ],
    "hydration": "2.5-3L water daily",
    "supplements": ["Whey protein", "Vitamin D3"],
    "weekly_notes": ""
  },
  "coach_note": "A short encouraging 2-3 sentence note for the client about this week's focus."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await createEscalation('program', client.id, client.phone,
        'Claude API returned non-JSON response');
      return json(res, { error: 'Failed to parse program' }, 500);
    }

    const program = JSON.parse(jsonMatch[0]);

    const outputStr = JSON.stringify(program).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (outputStr.includes(flag)) {
        await createEscalation('program', client.id, client.phone,
          `Safety flag: "${flag}" in generated program for week ${week_no}`);
        return json(res, {
          error: 'Program flagged for safety review',
          flag,
        }, 422);
      }
    }

    const pdfBuffer = generateProgramPDF(client, week_no, program);
    const pdfPath = `clients/${client.id}/week_${week_no}.pdf`;

    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    const { data: saved } = await db
      .from('programs')
      .upsert(
        {
          client_id,
          week_no,
          generated_at: new Date().toISOString(),
          pdf_url: publicUrl?.publicUrl || pdfPath,
          workout_plan: program.workout_plan,
          nutrition_plan: program.nutrition_plan,
          notes: program.coach_note,
        },
        { onConflict: 'client_id,week_no' }
      )
      .select()
      .single();

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      program.coach_note || 'Your new program is ready!',
    ], publicUrl?.publicUrl);

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', saved.id);

    return json(res, {
      action: 'program_generated',
      program_id: saved.id,
      week_no,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};

function generateProgramPDF(client, weekNo, program) {
  const PDFDocument = require('pdfkit');

  const chunks = [];
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  doc.on('data', (chunk) => chunks.push(chunk));

  const BLACK = '#1A1A1A';
  const GOLD = '#B8965A';
  const CHARCOAL = '#2C2C2C';

  doc
    .rect(0, 0, 595, 80)
    .fill(BLACK);

  doc
    .fill('#FFFFFF')
    .fontSize(22)
    .font('Helvetica-Bold')
    .text('FITNESSBYMADDY', 50, 25, { align: 'left' });

  doc
    .fill(GOLD)
    .fontSize(12)
    .font('Helvetica')
    .text(`WEEK ${weekNo} PROGRAM`, 50, 52, { align: 'left' });

  doc
    .fill('#FFFFFF')
    .fontSize(10)
    .text(`${client.name || 'Client'} | ${client.program}`, 350, 35, {
      align: 'right',
      width: 195,
    });

  doc.moveDown(2);

  const wp = program.workout_plan;
  if (wp && wp.days) {
    doc.fill(CHARCOAL).fontSize(16).font('Helvetica-Bold').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.fill(GOLD).rect(50, doc.y, 100, 2).fill(GOLD);
    doc.moveDown(0.8);

    for (const day of wp.days) {
      doc.fill(CHARCOAL).fontSize(13).font('Helvetica-Bold')
        .text(`${day.day} — ${day.focus}`, 50);
      doc.moveDown(0.3);

      if (day.warmup) {
        doc.fill('#555').fontSize(9).font('Helvetica')
          .text(`Warm-up: ${day.warmup}`, 60);
      }
      doc.moveDown(0.2);

      if (day.exercises) {
        for (const ex of day.exercises) {
          doc.fill(CHARCOAL).fontSize(10).font('Helvetica')
            .text(`• ${ex.name}  —  ${ex.sets}×${ex.reps}  (rest: ${ex.rest})`, 60);
          if (ex.notes) {
            doc.fill('#777').fontSize(8).text(`  ${ex.notes}`, 70);
          }
        }
      }

      if (day.cooldown) {
        doc.moveDown(0.2);
        doc.fill('#555').fontSize(9).font('Helvetica')
          .text(`Cool-down: ${day.cooldown}`, 60);
      }
      doc.moveDown(0.6);

      if (doc.y > 700) doc.addPage();
    }

    if (wp.weekly_notes) {
      doc.moveDown(0.3);
      doc.fill('#555').fontSize(9).font('Helvetica-Oblique')
        .text(wp.weekly_notes, 50);
    }
  }

  doc.moveDown(1);
  if (doc.y > 600) doc.addPage();

  const np = program.nutrition_plan;
  if (np) {
    doc.fill(CHARCOAL).fontSize(16).font('Helvetica-Bold').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.fill(GOLD).rect(50, doc.y, 100, 2).fill(GOLD);
    doc.moveDown(0.8);

    doc.fill(CHARCOAL).fontSize(10).font('Helvetica')
      .text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 50);
    doc.moveDown(0.5);

    if (np.meals) {
      for (const meal of np.meals) {
        doc.fill(CHARCOAL).fontSize(10).font('Helvetica-Bold')
          .text(`${meal.meal}:`, 60);
        doc.fill('#444').fontSize(10).font('Helvetica')
          .text(meal.example, 60);
        doc.moveDown(0.3);
      }
    }

    if (np.hydration) {
      doc.moveDown(0.3);
      doc.fill('#555').fontSize(9).text(`Hydration: ${np.hydration}`, 60);
    }

    if (np.supplements && np.supplements.length > 0) {
      doc.fill('#555').fontSize(9)
        .text(`Supplements: ${np.supplements.join(', ')}`, 60);
    }

    if (np.weekly_notes) {
      doc.moveDown(0.3);
      doc.fill('#555').fontSize(9).font('Helvetica-Oblique')
        .text(np.weekly_notes, 50);
    }
  }

  if (program.coach_note) {
    doc.moveDown(1.5);
    doc.fill(GOLD).rect(50, doc.y, 495, 1).fill(GOLD);
    doc.moveDown(0.5);
    doc.fill(CHARCOAL).fontSize(11).font('Helvetica-Oblique')
      .text(`"${program.coach_note}"`, 50, doc.y, { width: 495, align: 'center' });
  }

  const pageH = 842;
  doc
    .fill('#999')
    .fontSize(7)
    .font('Helvetica')
    .text('fitnessbymaddy.com | @fitnessbymaddyy', 50, pageH - 30, {
      align: 'center',
      width: 495,
    });

  doc.end();

  return Buffer.concat(chunks);
}
