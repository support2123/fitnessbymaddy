const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i,
  /under\s*1000\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /anabolic/i,
  /steroid/i,
  /lose\s*\d{2,}\s*kg\s*in\s*1\s*week/i
];

function isSafeProgram(content) {
  const text = JSON.stringify(content);
  return !UNSAFE_PATTERNS.some(p => p.test(text));
}

async function generatePDF(workout, nutrition, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(24).fill('#B8965A').text('FITNESS BY MADDY', 50, 25);
    doc.fontSize(10).fill('#FFFFFF').text(`Week ${weekNo} Program — ${clientName}`, 50, 55);

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    doc.fontSize(18).text('WORKOUT PLAN', 50, 110);
    doc.moveTo(50, 132).lineTo(545, 132).stroke('#B8965A');
    doc.moveDown(1);

    let y = 145;
    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).fill('#B8965A').text(day.name || 'Day', 50, y);
        y += 18;
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#2C2C2C').text(
              `• ${ex.name} — ${ex.sets || '3'} x ${ex.reps || '12'} ${ex.notes ? '(' + ex.notes + ')' : ''}`,
              70, y
            );
            y += 16;
          }
        }
        y += 10;
      }
    } else {
      doc.fontSize(10).fill('#2C2C2C').text(JSON.stringify(workout, null, 2).substring(0, 2000), 50, y, { width: 495 });
    }

    doc.addPage();
    y = 50;

    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(24).fill('#B8965A').text('NUTRITION PLAN', 50, 25);
    doc.fontSize(10).fill('#FFFFFF').text(`Week ${weekNo}`, 50, 55);

    y = 100;
    doc.fill('#2C2C2C');
    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).fill('#B8965A').text(meal.name || 'Meal', 50, y);
        y += 18;
        if (meal.items) {
          for (const item of meal.items) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#2C2C2C').text(`• ${item}`, 70, y);
            y += 16;
          }
        }
        y += 8;
      }

      if (nutrition.macros) {
        y += 10;
        doc.fontSize(12).fill('#B8965A').text('Daily Macros', 50, y);
        y += 18;
        doc.fontSize(10).fill('#2C2C2C').text(
          `Calories: ${nutrition.macros.calories || 'TBD'} | Protein: ${nutrition.macros.protein || 'TBD'}g | Carbs: ${nutrition.macros.carbs || 'TBD'}g | Fats: ${nutrition.macros.fats || 'TBD'}g`,
          50, y
        );
      }
    } else {
      doc.fontSize(10).fill('#2C2C2C').text(JSON.stringify(nutrition, null, 2).substring(0, 2000), 50, y, { width: 495 });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

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

    const systemPrompt = `You are a certified fitness coach assistant for FitnessByMaddy.
Generate a weekly workout and nutrition plan in JSON format.
Be evidence-based. Never recommend extreme calorie restrictions (under 1200 for women, under 1500 for men),
banned substances, or unrealistic timelines.
Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "name": "Day 1 - Push", "exercises": [
        { "name": "Bench Press", "sets": "4", "reps": "8-10", "notes": "slow eccentric" }
      ]}
    ],
    "rest_day_notes": "Active recovery — 20min walk"
  },
  "nutrition_plan": {
    "macros": { "calories": 2000, "protein": 150, "carbs": 200, "fats": 67 },
    "meals": [
      { "name": "Meal 1 — Breakfast", "items": ["3 eggs scrambled", "2 toast wheat", "1 banana"] }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "coach_note": "One line context for this week"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${intake?.goal || 'general fitness'}
- Age: ${intake?.age || 'unknown'}
- Gender: ${intake?.gender || 'unknown'}
- Height: ${intake?.height_cm || 'unknown'}cm
- Weight: ${intake?.weight_kg || recentCheckins?.[0]?.weight || 'unknown'}kg
- Injuries: ${intake?.injuries || 'none reported'}
- Diet preference: ${intake?.diet_preference || 'no preference'}
- Equipment: ${intake?.available_equipment || 'full gym'}
- Training experience: ${intake?.training_experience || 'intermediate'}

${recentCheckins?.length ? `Recent Check-ins:
${recentCheckins.map(c => `  Week ${c.week_no}: weight=${c.weight}kg, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')}` : 'No previous check-ins yet.'}

${lastProgram ? `Last week's focus: ${lastProgram.notes || 'standard progression'}` : 'This is the first week.'}

Generate the complete Week ${week_no} plan.`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      system: systemPrompt
    });

    const aiText = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse AI response');
      return res.status(500).json({ error: 'AI returned invalid JSON' });
    }

    if (!isSafeProgram(parsed)) {
      await escalateToMaddy(
        'Unsafe program generated — halted',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nFlagged for unsafe content. Manual review required.`
      );
      return res.status(200).json({ flagged: true, message: 'Program flagged for manual review' });
    }

    const pdfBuffer = await generatePDF(
      parsed.workout_plan,
      parsed.nutrition_plan,
      client.name || 'Client',
      week_no
    );

    const filePath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      parsed.coach_note || `Your Week ${week_no} plan is ready!`
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week=${week_no}`);
    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
