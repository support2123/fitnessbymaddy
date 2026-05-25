const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'sarm',
  'steroid', 'testosterone inject', 'hgh inject',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generatePDF(workout, nutrition, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 100).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program — ${clientName || 'Client'}`, 50, 65);

    doc.moveDown(3);

    // Workout section
    doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, 130);
    doc.moveTo(50, 155).lineTo(545, 155).stroke('#B8965A');
    doc.moveDown(1);

    doc.fill('#333333').fontSize(11).font('Helvetica');
    if (typeof workout === 'string') {
      doc.text(workout, 50, 170, { width: 495, lineGap: 4 });
    } else if (workout && typeof workout === 'object') {
      let y = 170;
      for (const [day, exercises] of Object.entries(workout)) {
        doc.fill('#2C2C2C').fontSize(13).font('Helvetica-Bold')
          .text(day.toUpperCase(), 50, y);
        y += 20;
        doc.fill('#555555').fontSize(10).font('Helvetica');
        if (Array.isArray(exercises)) {
          for (const ex of exercises) {
            const line = typeof ex === 'string' ? ex : `${ex.name} — ${ex.sets}x${ex.reps}`;
            doc.text(`  • ${line}`, 60, y, { width: 485 });
            y += 16;
          }
        } else if (typeof exercises === 'string') {
          doc.text(exercises, 60, y, { width: 485 });
          y += 16;
        }
        y += 8;
        if (y > 700) { doc.addPage(); y = 50; }
      }
    }

    // Nutrition section on new page
    doc.addPage();
    doc.rect(0, 0, 595, 60).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(20).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 20);

    doc.fill('#333333').fontSize(11).font('Helvetica');
    if (typeof nutrition === 'string') {
      doc.text(nutrition, 50, 80, { width: 495, lineGap: 4 });
    } else if (nutrition && typeof nutrition === 'object') {
      let y = 80;
      for (const [key, val] of Object.entries(nutrition)) {
        doc.fill('#2C2C2C').fontSize(13).font('Helvetica-Bold')
          .text(key.toUpperCase(), 50, y);
        y += 20;
        doc.fill('#555555').fontSize(10).font('Helvetica');
        const text = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
        doc.text(text, 60, y, { width: 485, lineGap: 3 });
        y += doc.heightOfString(text, { width: 485 }) + 12;
        if (y > 700) { doc.addPage(); y = 50; }
      }
    }

    // Footer
    doc.moveDown(2);
    doc.fill('#B8965A').fontSize(9).font('Helvetica')
      .text('Fitness by Maddy — fitnessbymaddy.com — This program is personalised. Do not share.', 50, doc.y, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
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

    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const prompt = `You are a world-class certified fitness coach and nutritionist creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${week_no} of 12

${intake ? `INTAKE DATA:
- Age: ${intake.age}, Gender: ${intake.gender}
- Height: ${intake.height_cm}cm, Starting Weight: ${intake.weight_kg}kg
- Goal: ${intake.goal}
- Injuries/limitations: ${intake.injuries || 'None reported'}
- Medical conditions: ${intake.medical_conditions || 'None'}
- Diet preference: ${intake.diet_preference || 'No preference'}
- Workout days/week: ${intake.workout_days_per_week || 5}
- Gym or home: ${intake.gym_or_home || 'gym'}
- Wake: ${intake.wake_time || 'N/A'}, Sleep: ${intake.sleep_time || 'N/A'}` : 'No intake data available.'}

${recentCheckins?.length ? `RECENT CHECK-INS:
${recentCheckins.map(c => `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No previous check-ins yet.'}

Generate a detailed, actionable weekly program with:
1. WORKOUT PLAN: A structured plan for each training day (${intake?.workout_days_per_week || 5} days). For each exercise: name, sets, reps, rest. Include warm-up and cool-down.
2. NUTRITION PLAN: Daily calorie target, macro split (protein/carbs/fats in grams), meal timing with example meals, hydration.

RULES:
- Be specific: exact exercises, exact numbers
- Progressive overload from previous weeks if check-in data available
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or supplements beyond basic (creatine, whey, vitamins)
- If client reported injuries/pain, program around them safely
- Be encouraging but realistic — no "lose 10kg in a week" claims

Respond with valid JSON only:
{
  "workout_plan": { "Day 1 - Chest & Triceps": [...], ... },
  "nutrition_plan": { "calories": "...", "macros": "...", "meals": {...}, "hydration": "..." },
  "coach_note": "A 1-2 sentence personalized note for this week"
}`;

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    if (hasSafetyIssue(content)) {
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy(
        client.phone,
        'unsafe_program_content',
        `Generated program for W${week_no} flagged for safety review`,
        client_id,
        client.lead_id
      );
      return res.status(200).json({ flagged: true, reason: 'safety_review' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = { workout_plan: content, nutrition_plan: 'See workout plan above', coach_note: '' };
    }

    const pdfBuffer = await generatePDF(
      parsed.workout_plan,
      parsed.nutrition_plan,
      client.name,
      week_no
    );

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    const { data: program, error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: urlData.publicUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null
    }).select().single();

    if (insertError) throw insertError;

    const market = detectMarket(client.phone);
    let msg;
    if (market === 'IN') {
      msg = `🔥 Week ${week_no} ka plan ready hai!\n\n${parsed.coach_note || ''}\n\n📄 PDF: ${urlData.publicUrl}\n\nQuestions ho toh message karo. Let's crush it! 💪`;
    } else {
      msg = `🔥 Your Week ${week_no} plan is ready!\n\n${parsed.coach_note || ''}\n\n📄 PDF: ${urlData.publicUrl}\n\nAny questions? Just message. Let's crush it! 💪`;
    }

    await sendWhatsApp(client.phone, msg, null);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
