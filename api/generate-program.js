const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendMedia } = require('../lib/whatsapp');
const { cors, maskPhone, PROGRAM_NAMES } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified personal trainer and nutrition coach creating a weekly program for a client.
Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS", "duration": "30min" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1 description", "Option 2 description"] },
      ...
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3L water daily"
  },
  "coach_note": "Brief motivational and context note for the client"
}

Rules:
- Never recommend calorie intake below 1200 for women or 1500 for men
- Never recommend banned substances, steroids, SARMs, or dangerous supplements
- Never promise unrealistic timelines (e.g., "lose 10kg in 1 week")
- Base progressions on the client's check-in data
- Be specific with exercise names, sets, reps, and rest periods
- Account for injuries or medical conditions listed in the profile`;

    const userPrompt = buildClientPrompt(client, recentCheckins, lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalate(client.phone, 'Program generation returned invalid JSON', content.slice(0, 500));
      return res.status(500).json({ error: 'Invalid program format' });
    }

    const program = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(program).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
    if (flagged) {
      await escalate(client.phone, 'Program flagged for safety review', `Week ${week_no} program contains safety concerns`);
      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: `FLAGGED FOR REVIEW: ${program.coach_note || ''}`
      });
      return res.status(200).json({ success: true, flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, program, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || '';

    await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.coach_note || '',
      pdf_url: pdfUrl
    });

    await sendMedia(client.phone, pdfUrl,
      `Week ${week_no} program is ready! 🔥 ${program.coach_note || ''}`
    );

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

function buildClientPrompt(client, checkins, lastProgram, weekNo) {
  const intake = client.intake_data || {};
  let prompt = `Create Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${PROGRAM_NAMES[client.program] || client.program}\n`;
  if (intake.age) prompt += `Age: ${intake.age}\n`;
  if (intake.gender) prompt += `Gender: ${intake.gender}\n`;
  if (intake.goal) prompt += `Goal: ${intake.goal}\n`;
  if (intake.injuries) prompt += `Injuries/Limitations: ${intake.injuries}\n`;
  if (intake.medical_conditions) prompt += `Medical conditions: ${intake.medical_conditions}\n`;
  if (intake.diet_preference) prompt += `Diet preference: ${intake.diet_preference}\n`;
  if (intake.experience_level) prompt += `Experience: ${intake.experience_level}\n`;
  if (intake.schedule) prompt += `Available days: ${intake.schedule}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: Weight=${c.weight || '?'}kg, Waist=${c.waist || '?'}cm, `;
      prompt += `Compliance=${c.compliance_score || '?'}/10, Energy=${c.energy || '?'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  if (lastProgram) {
    prompt += `\nLast week's program summary:\n`;
    if (lastProgram.nutrition_plan?.calories) {
      prompt += `  Calories: ${lastProgram.nutrition_plan.calories}\n`;
    }
    if (lastProgram.notes) prompt += `  Coach note: ${lastProgram.notes}\n`;
  }

  return prompt;
}

async function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75);
    doc.fontSize(10).fill('#D4AF7A')
      .text(`${client.name || 'Client'} | ${PROGRAM_NAMES[client.program] || client.program}`, 50, 95);

    let y = 140;

    if (program.coach_note) {
      doc.fontSize(10).fill('#6B6B6B').text(program.coach_note, 50, y, { width: 495 });
      y += doc.heightOfString(program.coach_note, { width: 495 }) + 20;
    }

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50, y);
    y += 30;
    doc.moveTo(50, y).lineTo(545, y).stroke('#B8965A');
    y += 15;

    if (program.workout_plan?.days) {
      for (const day of program.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).fill('#B8965A').text(day.day.toUpperCase(), 50, y);
        doc.fontSize(10).fill('#6B6B6B').text(day.focus || '', 200, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            doc.fontSize(9).fill('#2C2C2C')
              .text(`• ${ex.name}`, 70, y)
              .text(`${ex.sets}×${ex.reps}`, 320, y)
              .text(`Rest: ${ex.rest || '-'}`, 420, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    if (program.workout_plan?.cardio) {
      if (y > 700) { doc.addPage(); y = 50; }
      const cardio = program.workout_plan.cardio;
      doc.fontSize(11).fill('#B8965A').text('CARDIO', 50, y);
      y += 18;
      doc.fontSize(9).fill('#2C2C2C')
        .text(`${cardio.type || 'Cardio'} — ${cardio.frequency || ''} — ${cardio.duration || ''}`, 70, y);
      y += 25;
    }

    if (y > 600) { doc.addPage(); y = 50; }
    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50, y);
    y += 30;
    doc.moveTo(50, y).lineTo(545, y).stroke('#B8965A');
    y += 15;

    if (program.nutrition_plan) {
      const np = program.nutrition_plan;
      doc.fontSize(10).fill('#2C2C2C')
        .text(`Calories: ${np.calories || '-'} | Protein: ${np.protein_g || '-'}g | Carbs: ${np.carbs_g || '-'}g | Fat: ${np.fat_g || '-'}g`, 50, y);
      y += 25;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill('#B8965A').text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              if (y > 730) { doc.addPage(); y = 50; }
              doc.fontSize(9).fill('#6B6B6B').text(`  → ${opt}`, 70, y, { width: 460 });
              y += doc.heightOfString(`  → ${opt}`, { width: 460 }) + 4;
            }
          }
          y += 8;
        }
      }

      if (np.supplements?.length) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(11).fill('#B8965A').text('SUPPLEMENTS', 50, y);
        y += 16;
        doc.fontSize(9).fill('#6B6B6B').text(np.supplements.join(' | '), 70, y);
        y += 20;
      }

      if (np.hydration) {
        doc.fontSize(9).fill('#6B6B6B').text(`Hydration: ${np.hydration}`, 70, y);
      }
    }

    doc.end();
  });
}
