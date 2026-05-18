const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { json, maskPhone } = require('../lib/utils');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /very\s*low\s*calorie/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|steroids|sarms/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*in\s*(1|2)\s*week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return json(res, { error: 'Missing client_id or week_no' }, 400);
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      return json(res, { error: 'Active client not found' }, 404);
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .maybeSingle();

    if (existingProgram) {
      return json(res, { error: 'Program already exists for this week' }, 409);
    }

    const anthropic = new Anthropic();

    const prompt = buildPrompt(client, recentCheckins, week_no);
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(content)) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy(
          client.phone,
          'Risky content in generated program',
          `Week ${week_no} program flagged: ${pattern.toString()}`,
          client_id
        );
        return json(res, { error: 'Program flagged for review', flagged: true }, 422);
      }
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `${client.id}/week_${week_no}.pdf`;
    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: parsed.workout_plan || parsed.workouts || {},
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
        notes: parsed.coach_notes || null
      })
      .select()
      .single();

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(week_no)],
      body: `Week ${week_no} program ready! Check your personalized plan.`,
      media: { url: pdfUrl, filename: `week_${week_no}_program.pdf` }
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return json(res, { success: true, program_id: program.id, week_no });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};

function buildPrompt(client, checkins, weekNo) {
  const checkinSummary = checkins && checkins.length > 0
    ? checkins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues=${c.issues || 'none'}`).join('\n')
    : 'No previous check-ins available.';

  return `You are a NASM-certified fitness program architect for FitnessByMaddy.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

RECENT CHECK-INS:
${checkinSummary}

GENERATE Week ${weekNo} program as JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [{ "meal": "Breakfast", "options": ["..."] }],
    "supplements": ["..."],
    "hydration": "..."
  },
  "coach_notes": "Brief personalized note for the client"
}

RULES:
- Base progression on check-in data (increase load if compliance >7, reduce if <5)
- Never prescribe under 1400 calories for women or 1600 for men
- Never suggest banned substances or extreme protocols
- Keep exercises practical for ${client.goal || 'general fitness'}
- Account for any injuries: ${client.injuries || 'none'}
- Be warm, expert, encouraging — never bro-sciency`;
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fillColor('#B8965A')
      .fontSize(32)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 50, { align: 'center' });

    doc.fillColor('#ffffff')
      .fontSize(14)
      .font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 95, { align: 'center' });

    doc.fillColor('#B8965A')
      .fontSize(11)
      .text(`Client: ${client.name || 'Client'} | Program: ${client.program}`, 50, 120, { align: 'center' });

    doc.moveTo(50, 150).lineTo(doc.page.width - 50, 150).strokeColor('#B8965A').lineWidth(0.5).stroke();

    let y = 170;

    const workout = programData.workout_plan || programData.workouts;
    if (workout && workout.days) {
      doc.fillColor('#B8965A').fontSize(18).font('Helvetica-Bold').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }

        doc.fillColor('#D4AF7A').fontSize(13).font('Helvetica-Bold').text(`${day.day} — ${day.focus || ''}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
            doc.fillColor('#ffffff').fontSize(10).font('Helvetica')
              .text(`• ${ex.name} — ${ex.sets} x ${ex.reps} (Rest: ${ex.rest || '60s'})`, 65, y);
            y += 15;
            if (ex.notes) {
              doc.fillColor('#888888').fontSize(9).text(`  ${ex.notes}`, 75, y);
              y += 13;
            }
          }
        }
        y += 10;
      }
    }

    y += 10;
    const nutrition = programData.nutrition_plan || programData.nutrition;
    if (nutrition) {
      if (y > 600) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }

      doc.fillColor('#B8965A').fontSize(18).font('Helvetica-Bold').text('NUTRITION PLAN', 50, y);
      y += 25;

      if (nutrition.calories) {
        doc.fillColor('#ffffff').fontSize(11).font('Helvetica')
          .text(`Daily Target: ${nutrition.calories} kcal | P: ${nutrition.protein_g || '—'}g | C: ${nutrition.carbs_g || '—'}g | F: ${nutrition.fats_g || '—'}g`, 50, y);
        y += 25;
      }

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
          doc.fillColor('#D4AF7A').fontSize(11).font('Helvetica-Bold').text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fillColor('#ffffff').fontSize(10).font('Helvetica').text(`• ${opt}`, 65, y);
              y += 14;
            }
          }
          y += 5;
        }
      }
    }

    if (programData.coach_notes) {
      if (y > 680) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
      y += 15;
      doc.fillColor('#B8965A').fontSize(14).font('Helvetica-Bold').text('COACH NOTES', 50, y);
      y += 20;
      doc.fillColor('#cccccc').fontSize(10).font('Helvetica').text(programData.coach_notes, 50, y, { width: doc.page.width - 100 });
    }

    doc.end();
  });
}
