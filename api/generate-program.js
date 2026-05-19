const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { handleCors } = require('./_lib/cors');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /banned\s*substance/i,
  /steroid/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i
];

function auditProgramSafety(text) {
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      try {
        intakeData = lead?.first_msg ? JSON.parse(lead.first_msg) : {};
      } catch {
        intakeData = {};
      }
    }

    const anthropic = new Anthropic();
    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Never prescribe fewer than 1400 calories for women or 1600 for men
- Never recommend any banned substances or supplements not widely available
- Never promise specific weight loss timelines (e.g., "lose 10kg in 2 weeks")
- Always include rest days (minimum 1 per week)
- Always include warm-up and cool-down in workouts
- Be realistic and sustainable
- Adapt based on check-in data (compliance, energy, issues reported)

OUTPUT FORMAT: Return valid JSON with exactly these keys:
{
  "workout_plan": { "days": [...], "rest_days": [...], "notes": "..." },
  "nutrition_plan": { "daily_calories": N, "macros": {...}, "meal_suggestions": [...], "notes": "..." },
  "context_note": "One-liner summary to send via WhatsApp"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intakeData.age ? `- Age: ${intakeData.age}` : ''}
${intakeData.goal ? `- Goal: ${intakeData.goal}` : ''}
${intakeData.injuries ? `- Injuries/Limitations: ${intakeData.injuries}` : ''}
${intakeData.diet_preference ? `- Diet Preference: ${intakeData.diet_preference}` : ''}
${intakeData.schedule ? `- Schedule: ${intakeData.schedule}` : ''}

Recent Check-ins:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || 'none'}`).join('\n')
  : 'No previous check-ins (first week)'}

Generate the Week ${week_no} program as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData);
    if (!auditProgramSafety(fullText)) {
      await escalateToMaddy(
        'Unsafe program content flagged',
        `Client: ${maskPhone(client.phone)} | Week ${week_no} — AUTO-HALTED, needs manual review`
      );
      return res.json({ ok: false, halted: true, reason: 'Safety audit failed' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.context_note
    }).select().single();

    await sendWhatsApp({
      phone: client.phone,
      body: `Week ${week_no} program is ready! ${programData.context_note || ''}`
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(28).font('Helvetica-Bold')
      .fillColor('#B8965A')
      .text('FITNESS BY MADDY', { align: 'center' });

    doc.moveDown(0.5);
    doc.fontSize(18).font('Helvetica')
      .fillColor('#2C2C2C')
      .text(`Week ${weekNo} Program`, { align: 'center' });

    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#6B6B6B')
      .text(`Prepared for ${client.name || 'Client'} | ${client.program.toUpperCase()}`, { align: 'center' });

    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').stroke();

    // Workout Plan
    doc.moveDown(1);
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#2C2C2C')
      .text('WORKOUT PLAN');
    doc.moveDown(0.5);

    const workout = programData.workout_plan;
    if (workout.days) {
      workout.days.forEach(day => {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#B8965A')
          .text(day.day || day.name || 'Day');
        doc.fontSize(10).font('Helvetica').fillColor('#2C2C2C');

        const exercises = day.exercises || day.workout || [];
        if (Array.isArray(exercises)) {
          exercises.forEach(ex => {
            const line = typeof ex === 'string' ? ex : `${ex.name || ex.exercise} — ${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`;
            doc.text(`  ${line}`);
          });
        }
        doc.moveDown(0.5);
      });
    }

    if (workout.notes) {
      doc.fontSize(10).font('Helvetica').fillColor('#6B6B6B')
        .text(workout.notes);
    }

    // Nutrition Plan
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#2C2C2C')
      .text('NUTRITION PLAN');
    doc.moveDown(0.5);

    const nutrition = programData.nutrition_plan;
    if (nutrition.daily_calories) {
      doc.fontSize(12).font('Helvetica').fillColor('#2C2C2C')
        .text(`Daily Calories: ${nutrition.daily_calories} kcal`);
    }
    if (nutrition.macros) {
      const m = nutrition.macros;
      doc.text(`Macros: Protein ${m.protein || '—'}g | Carbs ${m.carbs || '—'}g | Fat ${m.fat || '—'}g`);
    }

    doc.moveDown(0.5);
    if (nutrition.meal_suggestions && nutrition.meal_suggestions.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#B8965A')
        .text('Meal Suggestions:');
      doc.fontSize(10).font('Helvetica').fillColor('#2C2C2C');
      nutrition.meal_suggestions.forEach(meal => {
        const line = typeof meal === 'string' ? meal : `${meal.name || meal.meal}: ${meal.description || meal.items || ''}`;
        doc.text(`  ${line}`);
      });
    }

    if (nutrition.notes) {
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').fillColor('#6B6B6B')
        .text(nutrition.notes);
    }

    // Footer
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('#6B6B6B')
      .text('fitnessbymaddy.com | This plan is personalized — do not share.', { align: 'center' });

    doc.end();
  });
}
