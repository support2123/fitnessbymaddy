const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, PROGRAM_NAMES } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'anabolic', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'no eating', 'zero calorie', 'water fast',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
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

    const { data: intake } = await db
      .from('intake_submissions')
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

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are "Program Architect" for Fitness by Maddy — an elite online coaching brand. You design weekly workout + nutrition plans for individual clients.

RULES:
- Plans must be safe, evidence-based, and appropriate for the client's level
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned substances, steroids, or extreme protocols
- Never promise specific weight loss timelines
- Consider injuries, medical conditions, and dietary preferences
- Output must be valid JSON with "workout_plan" and "nutrition_plan" keys
- workout_plan: array of 7 day objects, each with "day", "focus", "exercises" (array of {name, sets, reps, rest, notes})
- nutrition_plan: object with "daily_calories", "protein_g", "carbs_g", "fat_g", "meal_plan" (array of {meal, time, foods, notes})
- Include a "coach_note" field with a brief motivational note for the client`;

    const userPrompt = buildUserPrompt(client, intake, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const lowerResponse = responseText.toLowerCase();
    const hasSafetyFlag = SAFETY_FLAGS.some(flag => lowerResponse.includes(flag));
    if (hasSafetyFlag) {
      await sendWhatsApp('+917082478374', 'escalation_alert', [
        client.name || 'Unknown',
        'safety_flag_program',
        `Week ${week_no} program for ${client.name} flagged for safety review`,
      ]);
      return res.status(200).json({
        success: false,
        reason: 'Safety flag — sent to Maddy for review',
      });
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `${client.folder_url || 'clients/' + client.id}/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(storagePath);

    const pdfUrl = publicUrl?.publicUrl || '';

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || null,
    });

    if (pdfUrl) {
      const market = detectMarket(client.phone);
      const templateName = market === 'IN' ? 'program_delivery_hi' : 'program_delivery_en';
      await sendWhatsApp(client.phone, templateName, [
        client.name || 'there',
        String(week_no),
        programData.coach_note || 'Your new program is ready!',
      ], pdfUrl);

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Generate a Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${PROGRAM_NAMES[client.program] || client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'Unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'Unknown'}\n`;
    prompt += `Goal: ${intake.goal || 'General fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'None reported'}\n`;
    prompt += `Medical conditions: ${intake.medical_conditions || 'None reported'}\n`;
    prompt += `Diet preference: ${intake.diet_preference || 'No restrictions'}\n`;
    prompt += `Workout schedule: ${intake.workout_schedule || 'Flexible'}\n`;
    prompt += `Experience: ${intake.experience_level || 'Intermediate'}\n`;
    prompt += `Current weight: ${intake.current_weight || 'Unknown'}kg\n`;
    prompt += `Target weight: ${intake.target_weight || 'Unknown'}kg\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-in data:\n`;
    for (const ci of checkins) {
      prompt += `- Week ${ci.week_no}: Weight ${ci.weight || '?'}kg, `;
      prompt += `Waist ${ci.waist || '?'}cm, `;
      prompt += `Compliance ${ci.compliance_score || '?'}/10, `;
      prompt += `Energy ${ci.energy || '?'}/10`;
      if (ci.issues) prompt += `, Issues: ${ci.issues}`;
      if (ci.next_week_focus) prompt += `, Focus: ${ci.next_week_focus}`;
      prompt += `\n`;
    }
  }

  prompt += `\nReturn ONLY valid JSON.`;
  return prompt;
}

async function generatePDF(programData, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 72);
    doc.fontSize(11).fill('#D4AF7A')
      .text(`Prepared for ${client.name || 'Client'}`, 50, 92);

    doc.moveDown(3);

    // Coach note
    if (programData.coach_note) {
      doc.fontSize(11).fill('#B8965A').font('Helvetica-Bold')
        .text('FROM MADDY:', 50);
      doc.fontSize(10).fill('#2C2C2C').font('Helvetica')
        .text(programData.coach_note, 50, undefined, { width: 495 });
      doc.moveDown(1.5);
    }

    // Workout plan
    doc.fontSize(16).fill('#2C2C2C').font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke('#B8965A');
    doc.moveDown(0.8);

    if (programData.workout_plan && Array.isArray(programData.workout_plan)) {
      for (const day of programData.workout_plan) {
        if (doc.y > 700) doc.addPage();

        doc.fontSize(12).fill('#B8965A').font('Helvetica-Bold')
          .text(`${day.day || 'Day'} — ${day.focus || 'Training'}`, 50);
        doc.moveDown(0.3);

        if (day.exercises && Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            doc.fontSize(9).fill('#2C2C2C').font('Helvetica')
              .text(
                `  ${ex.name || 'Exercise'} — ${ex.sets || '?'}x${ex.reps || '?'} | Rest: ${ex.rest || '60s'}`,
                60, undefined, { width: 480 }
              );
            if (ex.notes) {
              doc.fontSize(8).fill('#6B6B6B')
                .text(`    ${ex.notes}`, 70, undefined, { width: 470 });
            }
          }
        }
        doc.moveDown(0.8);
      }
    }

    // Nutrition plan
    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(16).fill('#2C2C2C').font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).stroke('#B8965A');
    doc.moveDown(0.8);

    if (programData.nutrition_plan) {
      const np = programData.nutrition_plan;
      doc.fontSize(10).fill('#2C2C2C').font('Helvetica-Bold')
        .text(`Daily Target: ${np.daily_calories || '?'} kcal | Protein: ${np.protein_g || '?'}g | Carbs: ${np.carbs_g || '?'}g | Fat: ${np.fat_g || '?'}g`, 50);
      doc.moveDown(0.8);

      if (np.meal_plan && Array.isArray(np.meal_plan)) {
        for (const meal of np.meal_plan) {
          if (doc.y > 700) doc.addPage();

          doc.fontSize(10).fill('#B8965A').font('Helvetica-Bold')
            .text(`${meal.meal || 'Meal'} (${meal.time || ''})`, 50);
          doc.fontSize(9).fill('#2C2C2C').font('Helvetica')
            .text(`  ${meal.foods || ''}`, 60, undefined, { width: 480 });
          if (meal.notes) {
            doc.fontSize(8).fill('#6B6B6B')
              .text(`  ${meal.notes}`, 60, undefined, { width: 480 });
          }
          doc.moveDown(0.5);
        }
      }
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fill('#6B6B6B').font('Helvetica')
      .text('This program is designed specifically for you. Do not share or redistribute.', 50, undefined, { align: 'center' });
    doc.text('Fitness by Maddy | fitnessbymaddy.com | @fitnessbymaddy_', { align: 'center' });

    doc.end();
  });
}
