const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/mask-phone');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'steroids', 'anavar',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'no food', 'water fast'
];

function checkSafety(text) {
  const lower = (typeof text === 'string' ? text : JSON.stringify(text)).toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generatePDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill('#2C2C2C');
    doc.fontSize(24).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 25, { width: 495 });
    doc.fontSize(10).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program | ${client.name || 'Client'}`, 50, 55);

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    // Workout Plan
    doc.fontSize(18).text('WORKOUT PLAN', 50, 110);
    doc.moveTo(50, 132).lineTo(545, 132).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(1);

    if (workoutPlan && typeof workoutPlan === 'object') {
      const days = Array.isArray(workoutPlan) ? workoutPlan : Object.entries(workoutPlan);
      for (const item of days) {
        const [day, exercises] = Array.isArray(item) ? item : [item.day, item.exercises];
        doc.fontSize(12).fillColor('#B8965A').text(String(day).toUpperCase(), 50);
        doc.fontSize(10).fillColor('#2C2C2C');
        if (Array.isArray(exercises)) {
          for (const ex of exercises) {
            const line = typeof ex === 'string' ? ex : `${ex.name || ex.exercise} — ${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`;
            doc.text(`  ${line}`, 60);
          }
        } else {
          doc.text(`  ${String(exercises)}`, 60);
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).text(String(workoutPlan || 'Plan pending'), 60);
    }

    doc.moveDown(1);

    // Nutrition Plan
    doc.fontSize(18).fillColor('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(1);

    if (nutritionPlan && typeof nutritionPlan === 'object') {
      const meals = Array.isArray(nutritionPlan) ? nutritionPlan : Object.entries(nutritionPlan);
      for (const item of meals) {
        const [meal, details] = Array.isArray(item) ? item : [item.meal, item.foods];
        doc.fontSize(11).fillColor('#B8965A').text(String(meal).toUpperCase(), 50);
        doc.fontSize(10).fillColor('#2C2C2C');
        if (Array.isArray(details)) {
          for (const food of details) {
            doc.text(`  ${typeof food === 'string' ? food : food.item || JSON.stringify(food)}`, 60);
          }
        } else {
          doc.text(`  ${String(details)}`, 60);
        }
        doc.moveDown(0.3);
      }
    } else {
      doc.fontSize(10).text(String(nutritionPlan || 'Plan pending'), 60);
    }

    // Notes
    if (notes) {
      doc.moveDown(1);
      doc.fontSize(14).fillColor('#2C2C2C').text('COACH NOTES', 50);
      doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).strokeColor('#B8965A').lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).text(notes, 60, undefined, { width: 480 });
    }

    // Footer
    doc.fontSize(8).fillColor('#999999')
      .text('Fitness by Maddy | fitnessbymaddy.com | This plan is personalised — do not share.', 50, 760, {
        width: 495, align: 'center'
      });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Get client data
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Build Claude prompt
    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      started: client.program_started_at
    };

    const recentCheckins = (checkins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for Fitness by Maddy, an elite online coaching brand. You create weekly workout and nutrition plans that are:
- Science-backed and progressive
- Appropriate for the client's level and history
- Safe (never prescribe extreme calorie deficits below 1200cal for women or 1500cal for men, never recommend banned substances)
- Practical and sustainable

Output ONLY valid JSON with this exact structure:
{
  "workout_plan": [
    { "day": "Monday", "focus": "Upper Body", "exercises": [
      { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "RPE 7-8" }
    ]}
  ],
  "nutrition_plan": [
    { "meal": "Breakfast", "foods": ["3 eggs scrambled", "1 slice whole wheat toast", "1 cup spinach"], "calories": 350 }
  ],
  "total_calories": 1800,
  "protein_g": 140,
  "notes": "Focus on progressive overload this week. Increase bench by 2.5kg from last week."
}`;

    const userPrompt = `Create Week ${week_no} program for this client:

Client: ${JSON.stringify(clientProfile)}
Recent check-ins: ${JSON.stringify(recentCheckins)}

${recentCheckins.length > 0
  ? `Last weight: ${recentCheckins[0]?.weight}kg, compliance: ${recentCheckins[0]?.compliance}/10, energy: ${recentCheckins[0]?.energy}/10, issues: ${recentCheckins[0]?.issues || 'none'}`
  : 'First week — no check-in history yet. Create a solid baseline program.'}

Generate a complete weekly workout (5-6 days) and nutrition plan. Be specific with exercises, sets, reps, and meals.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    // Parse JSON from response
    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    // Safety check
    if (checkSafety(parsed)) {
      await escalateToMaddy(
        'Unsafe program content flagged',
        client.phone,
        `Week ${week_no} program contained safety flags. Halted auto-send.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged', client_id });
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(
      client, week_no,
      parsed.workout_plan, parsed.nutrition_plan, parsed.notes
    );

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload failed:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Store in programs table (audit trail)
    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        pdf_url: pdfUrl,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.notes
      })
      .select()
      .single();

    // Send via WhatsApp
    const contextNote = parsed.notes
      ? parsed.notes.split('.')[0]
      : `Week ${week_no} program ready`;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name ? client.name.split(' ')[0] : 'there',
      String(week_no),
      contextNote
    ], true);

    // Update sent timestamp
    if (program) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({
      ok: true,
      program_id: program?.id,
      pdf_url: pdfUrl
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
