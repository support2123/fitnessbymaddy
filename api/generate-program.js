const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'ephedra', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('intake_data').eq('id', client.lead_id).single()
      : { data: null };

    const prompt = buildPrompt(client, checkins || [], lead?.intake_data);

    const claudeKey = process.env.CLAUDE_API_KEY;
    if (!claudeKey) {
      return res.status(500).json({ error: 'CLAUDE_API_KEY not configured' });
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    const lowerResponse = responseText.toLowerCase();
    const hasSafetyIssue = SAFETY_FLAGS.some(flag => lowerResponse.includes(flag));
    if (hasSafetyIssue) {
      await notifyMaddy(
        'Program safety flag',
        `Client: ${maskPhone(client.phone)} (${client.name})\nWeek ${week_no}\nGenerated program flagged for review before sending.`
      );
      await db.from('programs').upsert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: { flagged: true, raw: responseText },
        nutrition_plan: { flagged: true },
        notes: 'SAFETY FLAG - awaiting Maddy review'
      }, { onConflict: 'client_id,week_no' });
      return res.status(200).json({ success: true, flagged: true });
    }

    let workoutPlan, nutritionPlan;
    try {
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workoutPlan = parsed.workout || parsed.workout_plan || parsed;
        nutritionPlan = parsed.nutrition || parsed.nutrition_plan || {};
      } else {
        workoutPlan = { raw: responseText };
        nutritionPlan = {};
      }
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
    }

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client_id}/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    let pdfUrl = null;
    if (!uploadError) {
      const { data: urlData } = db.storage
        .from('programs')
        .getPublicUrl(storagePath);
      pdfUrl = urlData?.publicUrl;
    }

    const { data: program } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: `Auto-generated for week ${week_no}`
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (pdfUrl) {
      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_program',
        body: `Your Week ${week_no} program is ready! Check it out and let us know if you have questions.`,
        params: [client.name || 'there', String(week_no)],
        isClient: true
      });

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intakeData) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let context = `You are a certified fitness program architect for FitnessByMaddy.
Create a detailed weekly training and nutrition plan for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
`;

  if (intakeData) {
    context += `- Age: ${intakeData.age || 'N/A'}
- Goal: ${intakeData.goal || 'General fitness'}
- Injuries: ${intakeData.injuries || 'None reported'}
- Diet preference: ${intakeData.diet_pref || 'No preference'}
- Schedule: ${intakeData.schedule || 'Flexible'}
- Medical: ${intakeData.medical_conditions || 'None'}
`;
  }

  if (lastCheckin) {
    context += `
LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
`;
  }

  if (prevCheckin) {
    context += `
PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
`;
  }

  context += `
OUTPUT FORMAT:
Return a JSON block wrapped in \`\`\`json ... \`\`\` with this structure:
{
  "workout": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "rest_days": ["Sunday"],
    "notes": "Progressive overload focus this week"
  },
  "nutrition": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fats_g": 70,
    "meal_timing": ["7am breakfast", "12pm lunch", "4pm pre-workout", "7pm dinner"],
    "notes": "Increase water intake to 3L"
  }
}

RULES:
- Be specific with exercise names, sets, reps, and rest periods
- Adjust based on check-in data (lower compliance = simplify, low energy = reduce volume)
- NEVER prescribe extreme calorie restriction (minimum 1200 kcal for women, 1500 for men)
- NEVER recommend banned substances or supplements without evidence
- Keep it evidence-based and safe
- Adapt to any injuries or medical conditions mentioned`;

  return context;
}

async function generatePDF(client, weekNo, workout, nutrition) {
  const PDFDocument = require('pdfkit');

  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fillColor('#888888')
      .text(client.name || 'Client', 50, 95, { align: 'center' });

    doc.moveDown(3);

    doc.fontSize(18).fillColor('#2C2C2C').text('WORKOUT PLAN', 50, 150);
    doc.moveTo(50, 172).lineTo(545, 172).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(1);

    let yPos = 185;
    if (workout.days && Array.isArray(workout.days)) {
      for (const day of workout.days) {
        if (yPos > 700) {
          doc.addPage();
          yPos = 50;
        }
        doc.fontSize(13).fillColor('#B8965A').text(day.day?.toUpperCase() || 'DAY', 50, yPos);
        doc.fontSize(10).fillColor('#666').text(day.focus || '', 200, yPos);
        yPos += 20;

        if (day.exercises && Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            if (yPos > 720) {
              doc.addPage();
              yPos = 50;
            }
            doc.fontSize(10).fillColor('#2C2C2C')
              .text(`  ${ex.name || 'Exercise'}`, 60, yPos);
            doc.fillColor('#666')
              .text(`${ex.sets || '-'} x ${ex.reps || '-'}  |  Rest: ${ex.rest || '-'}`, 280, yPos);
            yPos += 16;
          }
        }
        yPos += 12;
      }
    } else if (workout.raw) {
      doc.fontSize(10).fillColor('#2C2C2C').text(workout.raw.slice(0, 2000), 50, yPos, { width: 500 });
    }

    doc.addPage();
    doc.fontSize(18).fillColor('#2C2C2C').text('NUTRITION PLAN', 50, 50);
    doc.moveTo(50, 72).lineTo(545, 72).strokeColor('#B8965A').lineWidth(2).stroke();

    let nPos = 90;
    if (nutrition.calories) {
      doc.fontSize(12).fillColor('#2C2C2C').text('Daily Targets', 50, nPos);
      nPos += 25;

      const targets = [
        ['Calories', `${nutrition.calories} kcal`],
        ['Protein', `${nutrition.protein_g || '-'}g`],
        ['Carbs', `${nutrition.carbs_g || '-'}g`],
        ['Fats', `${nutrition.fats_g || '-'}g`]
      ];

      for (const [label, val] of targets) {
        doc.fontSize(10).fillColor('#666').text(label, 70, nPos);
        doc.fillColor('#2C2C2C').text(val, 200, nPos);
        nPos += 18;
      }
      nPos += 15;
    }

    if (nutrition.meal_timing && Array.isArray(nutrition.meal_timing)) {
      doc.fontSize(12).fillColor('#2C2C2C').text('Meal Timing', 50, nPos);
      nPos += 25;
      for (const meal of nutrition.meal_timing) {
        doc.fontSize(10).fillColor('#666').text(`  ${meal}`, 70, nPos);
        nPos += 16;
      }
      nPos += 15;
    }

    if (nutrition.notes) {
      doc.fontSize(12).fillColor('#2C2C2C').text('Notes', 50, nPos);
      nPos += 20;
      doc.fontSize(10).fillColor('#666').text(nutrition.notes, 70, nPos, { width: 460 });
    }

    doc.end();
  });
}
