const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const { parseBody, cors, json, programLabel } = require('./_lib/helpers');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'below 1000', 'below 800',
  'steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function checkProgramSafety(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.find(f => lower.includes(f)) || null;
}

async function generatePDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#D4AF7A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program — ${programLabel(client.program)}`, 50, 75, { align: 'center' });

    doc.fill('#2C2C2C');

    let y = 150;
    doc.fontSize(10).fill('#6B6B6B')
      .text(`Client: ${client.name || 'N/A'}  |  Generated: ${new Date().toLocaleDateString()}`, 50, y);
    y += 30;

    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50, y);
    y += 25;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(12).fill('#2C2C2C').text(day.name || day.day, 50, y);
        y += 18;
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  •  ${ex.name} — ${ex.sets || '3'}×${ex.reps || '12'} ${ex.notes || ''}`, 60, y);
            y += 15;
          }
        }
        y += 10;
      }
    } else {
      doc.fontSize(10).fill('#6B6B6B').text(JSON.stringify(workout, null, 2).slice(0, 1500), 50, y);
      y += 100;
    }

    if (y > 600) { doc.addPage(); y = 50; }
    y += 20;
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, y);
    y += 25;

    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(12).fill('#2C2C2C').text(meal.name || meal.meal, 50, y);
        y += 18;
        if (meal.items) {
          for (const item of meal.items) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#6B6B6B').text(`  •  ${item}`, 60, y);
            y += 15;
          }
        }
        y += 10;
      }
    } else {
      doc.fontSize(10).fill('#6B6B6B').text(JSON.stringify(nutrition, null, 2).slice(0, 1500), 50, y);
    }

    if (notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      y += 20;
      doc.fontSize(18).fill('#B8965A').text('COACH NOTES', 50, y);
      y += 25;
      doc.fontSize(10).fill('#6B6B6B').text(notes, 50, y, { width: 500 });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { client_id, week_no } = body;
  if (!client_id || !week_no) return json(res, 400, { error: 'client_id and week_no required' });

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();
  if (!client) return json(res, 404, { error: 'Client not found' });

  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: prevPrograms } = await supabase
    .from('programs')
    .select('workout_plan, nutrition_plan, week_no')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(1);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const prompt = `You are an expert fitness program architect for FitnessByMaddy.

Generate a Week ${week_no} personalized training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'N/A'}
- Program: ${programLabel(client.program)}
- Intake data: ${JSON.stringify(client.intake_data || {})}

RECENT CHECK-INS:
${JSON.stringify(recentCheckins || [], null, 2)}

PREVIOUS PROGRAM (for progression):
${JSON.stringify(prevPrograms?.[0] || 'None - this is week 1')}

RULES:
- Create progressive overload from the previous week
- Adjust based on compliance score and energy levels from check-ins
- If client reported issues, adapt the program accordingly
- Never recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances or supplements
- Be specific with exercise names, sets, reps, and rest periods
- Include warm-up and cool-down

Respond ONLY with valid JSON in this exact format:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "notes": "60s rest" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "macros": { "protein": "150g", "carbs": "180g", "fat": "60g" },
    "meals": [
      {
        "name": "Breakfast",
        "items": ["3 eggs scrambled", "2 toast whole wheat", "1 banana"]
      }
    ]
  },
  "notes": "Brief coach note for the client about focus areas this week"
}`;

  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return json(res, 500, { error: 'Program generation failed' });
  }

  const fullText = JSON.stringify(programData);
  const safetyIssue = checkProgramSafety(fullText);
  if (safetyIssue) {
    await supabase.from('escalations').insert({
      phone: client.phone,
      client_id,
      reason: `Program safety flag: ${safetyIssue}`,
      trigger_msg: `Week ${week_no} auto-generated program`,
    });
    const { sendWhatsApp: sw, notifyMaddy: nm } = require('./_lib/whatsapp');
    await nm(
      'Program safety flag',
      `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nFlag: ${safetyIssue}`
    );
    return json(res, 200, { flagged: true, reason: safetyIssue });
  }

  let pdfUrl = null;
  try {
    const pdfBuffer = await generatePDF(
      client, week_no,
      programData.workout_plan,
      programData.nutrition_plan,
      programData.notes
    );
    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (!uploadErr) {
      const { data: urlData } = supabase.storage.from('programs').getPublicUrl(filePath);
      pdfUrl = urlData?.publicUrl || null;
    }
  } catch (err) {
    console.error('PDF generation/upload error:', err.message);
  }

  const { data: program } = await supabase.from('programs').upsert({
    client_id,
    week_no: parseInt(week_no),
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.notes,
    pdf_url: pdfUrl,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,week_no' }).select().single();

  const contextNote = programData.notes || `Week ${week_no} program is ready!`;
  await sendWhatsApp({
    phone: client.phone,
    body: `📋 Week ${week_no} Program Ready!\n\n${contextNote}\n\n${pdfUrl ? `📎 PDF: ${pdfUrl}` : 'Your program details have been saved — check your dashboard.'}`,
  });

  await supabase.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  return json(res, 200, { success: true, program_id: program.id, pdf_url: pdfUrl });
};
