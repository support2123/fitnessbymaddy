const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/utils');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const DANGEROUS_PATTERNS = [
  /less than \d{3}\s*cal/i,
  /under 800\s*cal/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /anabolic/i,
  /steroid/i,
  /lose \d{2,}\s*(kg|lb|pound).*week/i,
];

function flagRiskyContent(text) {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) return pattern.toString();
  }
  return null;
}

async function generatePDF(client, weekNo, workout, nutrition) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`${client.name || 'Client'} — Week ${weekNo}`, 50, 75);
    doc.moveDown(3);

    doc.fill('#2C2C2C');
    doc.fontSize(18).text('WORKOUT PLAN', 50, 150);
    doc.moveTo(50, 175).lineTo(545, 175).stroke('#B8965A');
    doc.moveDown(0.5);

    if (workout && workout.days) {
      let y = 185;
      for (const day of workout.days) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        doc.fontSize(13).fill('#B8965A').text(day.name || day.day, 50, y);
        y += 20;
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C')
              .text(`• ${ex.name} — ${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`, 65, y);
            y += 16;
          }
        }
        y += 10;
      }
    } else {
      doc.fontSize(10).fill('#2C2C2C').text(JSON.stringify(workout, null, 2), 50);
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, 30);

    doc.fill('#2C2C2C');
    let ny = 100;
    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        doc.fontSize(12).fill('#B8965A').text(meal.name || meal.meal, 50, ny);
        ny += 18;
        if (meal.items) {
          for (const item of meal.items) {
            doc.fontSize(10).fill('#2C2C2C').text(`• ${item}`, 65, ny);
            ny += 15;
          }
        }
        ny += 8;
      }
    } else {
      doc.fontSize(10).fill('#2C2C2C').text(JSON.stringify(nutrition, null, 2), 50, ny);
    }

    if (nutrition && nutrition.macros) {
      ny += 20;
      doc.fontSize(12).fill('#B8965A').text('Daily Macros', 50, ny);
      ny += 18;
      doc.fontSize(10).fill('#2C2C2C')
        .text(`Calories: ${nutrition.macros.calories || 'N/A'} | Protein: ${nutrition.macros.protein || 'N/A'}g | Carbs: ${nutrition.macros.carbs || 'N/A'}g | Fat: ${nutrition.macros.fat || 'N/A'}g`, 50, ny);
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Create a personalized weekly training and nutrition plan.

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances or supplements requiring medical supervision
- Progressive overload: increase volume/intensity gradually based on check-in data
- If client reports pain or injury, reduce load on affected area and note for review
- Output MUST be valid JSON with "workout" and "nutrition" keys
- Workout must have a "days" array, each with "name" and "exercises" array
- Each exercise: {"name", "sets", "reps", "notes"}
- Nutrition must have "meals" array and "macros" object
- Each meal: {"name", "items": [strings]}
- Macros: {"calories", "protein", "carbs", "fat"}`;

    const userPrompt = `Client Profile:
- Name: ${client.name || 'N/A'}
- Program: ${client.program}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}
- Age: ${client.age || 'Not specified'}

Week ${week_no} of ${client.program === '12wk' ? '12' : '6'}

${recentCheckins && recentCheckins.length > 0 ? `Recent Check-ins:
${recentCheckins.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues="${c.issues || 'none'}"`).join('\n')}` : 'No previous check-ins.'}

${lastProgram ? `Last week's plan summary: ${lastProgram.notes || 'Standard program'}` : 'First week — create baseline program.'}

Generate the complete Week ${week_no} program as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON from Claude' });
    }

    const programData = JSON.parse(jsonMatch[0]);
    const workout = programData.workout;
    const nutrition = programData.nutrition;

    const riskyFlag = flagRiskyContent(content);
    if (riskyFlag) {
      const { sendEscalation } = require('./lib/whatsapp');
      await sendEscalation(
        `PROGRAM FLAGGED: Client ${client.name || maskPhone(client.phone)} Week ${week_no} — matched pattern: ${riskyFlag}. Program NOT sent. Review required.`
      );
      await supabase.from('programs').insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: workout,
        nutrition_plan: nutrition,
        notes: `FLAGGED: ${riskyFlag} — awaiting Maddy review`,
      });
      return res.status(200).json({ success: false, flagged: true, reason: riskyFlag });
    }

    const pdfBuffer = await generatePDF(client, week_no, workout, nutrition);

    const fileName = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    let pdfUrl = null;
    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from('programs')
        .getPublicUrl(fileName);
      pdfUrl = urlData?.publicUrl;
    }

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: workout,
      nutrition_plan: nutrition,
      notes: `Auto-generated Week ${week_no} program`,
    }).select().single();

    if (pdfUrl) {
      const note = week_no === 1
        ? `Welcome to Week 1! Here's your personalized program 💪`
        : `Week ${week_no} program is ready! Keep pushing 🔥`;

      await sendWhatsApp(client.phone, note);

      await supabase.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({
      success: true,
      program_id: program?.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
