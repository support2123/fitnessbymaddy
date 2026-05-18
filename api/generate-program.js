const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'anavar', 'steroids',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for weight loss'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      totalWeeks: 12,
      age: intake?.age,
      gender: intake?.gender,
      height: intake?.height,
      currentWeight: checkins?.[0]?.weight || intake?.weight,
      goal: intake?.goal,
      injuries: intake?.injuries,
      dietPreference: intake?.diet_preference,
      equipment: intake?.equipment,
      availableDays: intake?.available_days,
      recentCheckins: checkins || []
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: buildPrompt(clientProfile)
      }]
    });

    const content = response.content[0].text;
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    let programData;

    try {
      programData = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch {
      await notifyMaddy('Program Gen Failed', `Could not parse program for ${client.name} week ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const outputText = JSON.stringify(programData);
    const hasSafetyIssue = SAFETY_FLAGS.some(flag => outputText.toLowerCase().includes(flag));
    if (hasSafetyIssue) {
      await notifyMaddy(
        'Program Safety Flag',
        `Week ${week_no} program for ${client.name} flagged for unsafe content. Review before sending.`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: programData.workout_plan || programData.workouts,
        nutrition_plan: programData.nutrition_plan || programData.nutrition,
        notes: 'FLAGGED FOR REVIEW - Safety concern detected'
      });
      return res.status(200).json({ success: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || '';

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || programData.workouts,
      nutrition_plan: programData.nutrition_plan || programData.nutrition,
      notes: programData.coach_note || null
    });

    const contextNote = programData.coach_note
      || `Week ${week_no} program ready — ${programData.focus || 'progressive overload continues'}`;

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name,
      templateParams: [client.name, String(week_no), contextNote],
      media: pdfUrl ? { url: pdfUrl, filename: `Week_${week_no}_Program.pdf` } : {}
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(profile) {
  const checkinSummary = profile.recentCheckins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n') || 'No previous check-ins available.';

  return `You are an expert fitness coach creating a personalized weekly program.

CLIENT PROFILE:
- Name: ${profile.name}
- Program: ${profile.program} (Week ${profile.week} of ${profile.totalWeeks})
- Age: ${profile.age || 'Unknown'}, Gender: ${profile.gender || 'Unknown'}
- Height: ${profile.height || 'Unknown'}, Current Weight: ${profile.currentWeight || 'Unknown'}kg
- Goal: ${profile.goal || 'General fitness'}
- Injuries/Limitations: ${profile.injuries || 'None reported'}
- Diet Preference: ${profile.dietPreference || 'No restrictions'}
- Equipment Available: ${profile.equipment || 'Full gym'}
- Available Days: ${profile.availableDays || '5 days'}

RECENT CHECK-INS:
${checkinSummary}

Create a complete week ${profile.week} program. Output ONLY valid JSON with this structure:
{
  "focus": "Brief 1-line focus for this week",
  "coach_note": "Brief personalized note to the client (warm, expert tone, 1-2 sentences)",
  "workout_plan": {
    "days": [
      {
        "day": "Day 1",
        "title": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "notes": "Any dietary adjustments for this week"
  }
}

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never suggest any banned substances or supplements beyond basics (protein, creatine, multivitamin)
- Adjust based on check-in data (reduce volume if energy is low, adjust calories if weight stalled)
- Be specific with exercise names, sets, reps, and rest periods
- Include warm-up and cool-down recommendations`;
}

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 72, { align: 'center' });
    doc.fontSize(10).fill('#D4AF7A').text(client.name.toUpperCase(), 50, 95, { align: 'center' });

    let y = 140;

    if (programData.focus) {
      doc.fontSize(11).fill('#B8965A').text('WEEKLY FOCUS', 50, y);
      y += 18;
      doc.fontSize(10).fill('#2C2C2C').text(programData.focus, 50, y, { width: 495 });
      y += 30;
    }

    if (programData.workout_plan?.days) {
      doc.fontSize(16).fill('#2C2C2C').text('WORKOUT PLAN', 50, y);
      y += 8;
      doc.moveTo(50, y + 14).lineTo(545, y + 14).strokeColor('#B8965A').lineWidth(1).stroke();
      y += 24;

      for (const day of programData.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(12).fill('#B8965A').text(`${day.day}: ${day.title}`, 50, y);
        y += 20;

        doc.fontSize(8).fill('#6B6B6B')
          .text('EXERCISE', 50, y, { width: 180 })
          .text('SETS', 240, y, { width: 40 })
          .text('REPS', 290, y, { width: 60 })
          .text('REST', 360, y, { width: 50 })
          .text('NOTES', 420, y, { width: 125 });
        y += 14;
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#E8E3DC').lineWidth(0.5).stroke();
        y += 6;

        for (const ex of (day.exercises || [])) {
          if (y > 740) { doc.addPage(); y = 50; }
          doc.fontSize(9).fill('#2C2C2C')
            .text(ex.name, 50, y, { width: 180 })
            .text(String(ex.sets || ''), 240, y, { width: 40 })
            .text(ex.reps || '', 290, y, { width: 60 })
            .text(ex.rest || '', 360, y, { width: 50 })
            .text(ex.notes || '', 420, y, { width: 125 });
          y += 16;
        }
        y += 12;
      }
    }

    if (programData.nutrition_plan) {
      if (y > 600) { doc.addPage(); y = 50; }

      doc.fontSize(16).fill('#2C2C2C').text('NUTRITION PLAN', 50, y);
      y += 8;
      doc.moveTo(50, y + 14).lineTo(545, y + 14).strokeColor('#B8965A').lineWidth(1).stroke();
      y += 24;

      const np = programData.nutrition_plan;
      doc.fontSize(10).fill('#2C2C2C')
        .text(`Calories: ${np.calories || '—'}  |  Protein: ${np.protein_g || '—'}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fat: ${np.fat_g || '—'}g`, 50, y);
      y += 24;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill('#B8965A').text(meal.meal, 50, y);
          y += 16;
          for (const opt of (meal.options || [])) {
            doc.fontSize(9).fill('#2C2C2C').text(`  •  ${opt}`, 60, y, { width: 480 });
            y += 14;
          }
          y += 8;
        }
      }

      if (np.notes) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fontSize(9).fill('#6B6B6B').text(np.notes, 50, y, { width: 495 });
        y += 20;
      }
    }

    const bottomY = doc.page.height - 40;
    doc.fontSize(7).fill('#6B6B6B')
      .text('fitnessbymaddy.com  |  Personalized program — do not redistribute', 50, bottomY, { align: 'center', width: 495 });

    doc.end();
  });
}
