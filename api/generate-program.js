const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendMediaMessage } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/pii');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet',
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
      .select('*, leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: `You are a certified fitness program architect for FitnessByMaddy.
You create science-based, personalised weekly workout and nutrition plans.
Output ONLY valid JSON with keys: workout_plan, nutrition_plan, notes.
workout_plan: array of day objects {day, focus, exercises: [{name, sets, reps, rest, notes}]}
nutrition_plan: {calories, protein_g, carbs_g, fats_g, meals: [{meal, foods, macros}], hydration, supplements}
notes: string with 1-2 sentences of context for the client.
Never recommend extreme calorie cuts, banned substances, or unrealistic timelines.`,
    });

    const content = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      return res.status(500).json({ error: 'Failed to parse Claude response' });
    }

    const combined = JSON.stringify(parsed).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (combined.includes(flag)) {
        const { createEscalation } = require('./_lib/escalation');
        await createEscalation(
          client.phone, client_id,
          `Safety flag in generated program: "${flag}"`,
          `Week ${week_no} program contained flagged content`
        );
        return res.status(200).json({
          success: false,
          reason: 'safety_flagged',
          flag,
          message: 'Program flagged for Maddy review',
        });
      }
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = db.storage.from('clients').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
    }).select().single();

    try {
      await sendMediaMessage(
        client.phone,
        pdfUrl,
        `Week ${week_no} program is ready! ${parsed.notes || ''}`
      );
      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('id', program.id);
    } catch (err) {
      console.error('WhatsApp send failed:', err.message);
    }

    console.log(`Program generated: ${maskPhone(client.phone)}, week ${week_no}`);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl,
    });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  let prompt = `Create Week ${weekNo} program for client:\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (client.intake_data) {
    const intake = typeof client.intake_data === 'string'
      ? JSON.parse(client.intake_data) : client.intake_data;
    if (intake.goal) prompt += `Goal: ${intake.goal}\n`;
    if (intake.current_weight) prompt += `Current weight: ${intake.current_weight}\n`;
    if (intake.injuries) prompt += `Injuries/limitations: ${intake.injuries}\n`;
    if (intake.diet_preference) prompt += `Diet preference: ${intake.diet_preference}\n`;
    if (intake.equipment_access) prompt += `Equipment: ${intake.equipment_access}\n`;
    if (intake.workout_schedule) prompt += `Schedule: ${intake.workout_schedule}\n`;
  }

  if (checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: weight=${c.weight || 'N/A'}, `;
      prompt += `waist=${c.waist || 'N/A'}, compliance=${c.compliance_score || 'N/A'}/10, `;
      prompt += `energy=${c.energy || 'N/A'}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      prompt += `\n`;
    }
  }

  if (prevProgram) {
    prompt += `\nPrevious week plan summary available for progression.\n`;
  }

  prompt += `\nDesign a progressive, safe week ${weekNo} plan. `;
  prompt += `Include 5-6 training days with 1-2 rest days. `;
  prompt += `Nutrition should be realistic and sustainable. `;
  prompt += `Output valid JSON only.`;

  return prompt;
}

async function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#ffffff').text(
      `Week ${weekNo} Program | ${(client.name || 'Client').toUpperCase()}`,
      50, 75
    );
    doc.fontSize(10).fill('#888888').text(
      `Generated ${new Date().toLocaleDateString('en-IN')}`,
      50, 95
    );

    doc.moveDown(3);
    let y = 150;

    // Workout Plan
    if (plan.workout_plan && Array.isArray(plan.workout_plan)) {
      doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of plan.workout_plan) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill('#1a1a1a').text(
          `${day.day || 'Day'} — ${day.focus || ''}`, 50, y
        );
        y += 20;

        if (day.exercises && Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#444444').text(
              `  ${ex.name}  |  ${ex.sets || ''}x${ex.reps || ''}  |  Rest: ${ex.rest || '60s'}`,
              70, y
            );
            y += 16;
          }
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (plan.nutrition_plan) {
      if (y > 600) { doc.addPage(); y = 50; }

      y += 10;
      doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = plan.nutrition_plan;
      doc.fontSize(11).fill('#1a1a1a');

      if (np.calories) {
        doc.text(`Daily Calories: ${np.calories} kcal`, 50, y);
        y += 18;
      }
      if (np.protein_g) {
        doc.text(`Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fats: ${np.fats_g || '—'}g`, 50, y);
        y += 25;
      }

      if (np.meals && Array.isArray(np.meals)) {
        for (const meal of np.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill('#1a1a1a').text(meal.meal || 'Meal', 50, y);
          y += 16;
          const foods = Array.isArray(meal.foods) ? meal.foods.join(', ') : (meal.foods || '');
          doc.fontSize(10).fill('#444444').text(`  ${foods}`, 70, y, { width: 460 });
          y += doc.heightOfString(`  ${foods}`, { width: 460 }) + 8;
        }
      }
    }

    // Notes
    if (plan.notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.fontSize(12).fill('#B8965A').text('COACH NOTES', 50, y);
      y += 20;
      doc.fontSize(10).fill('#444444').text(plan.notes, 50, y, { width: 500 });
    }

    // Footer
    doc.fontSize(8).fill('#aaaaaa').text(
      'FitnessByMaddy.com | This program is personalised — do not share.',
      50, doc.page.height - 40, { align: 'center', width: 500 }
    );

    doc.end();
  });
}
