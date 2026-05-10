const { getSupabase } = require('../lib/supabase');
const { sendText, maskPhone } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Fetch client
    const { data: client } = await db.from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Fetch last 2 check-ins
    const { data: checkins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Fetch previous program if exists
    const { data: prevProgram } = await db.from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    // Build Claude prompt
    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      started: client.program_started_at,
    };

    const checkinSummary = (checkins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
    }));

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create safe, effective, science-backed weekly workout and nutrition plans.

RULES:
- Never recommend extreme calorie cuts (below 1200 kcal for women, 1500 for men)
- Never recommend banned or dangerous supplements
- Never promise unrealistic timelines (e.g., "lose 10kg in a week")
- Progressively overload from previous weeks
- Consider reported issues and energy levels
- If compliance is low, simplify rather than intensify
- Output MUST be valid JSON with "workout_plan" and "nutrition_plan" keys

Workout plan format: { days: [{ day: "Monday", focus: "Upper Body", exercises: [{ name, sets, reps, rest, notes }] }] }
Nutrition plan format: { daily_calories, protein_g, carbs_g, fats_g, meals: [{ meal: "Breakfast", options: ["..."] }], supplements: ["..."], hydration: "..." }`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT: ${JSON.stringify(clientProfile)}
RECENT CHECK-INS: ${JSON.stringify(checkinSummary)}
PREVIOUS PROGRAM: ${prevProgram ? JSON.stringify({ workout: prevProgram.workout_plan, nutrition: prevProgram.nutrition_plan }) : 'None (first week)'}

Create a progressive, personalized plan for Week ${week_no}. Return ONLY valid JSON.`;

    // Call Claude API
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawContent = response.content[0].text;

    // Parse JSON from response
    let programData;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse Claude response as JSON');
      await sendText('+917082478374',
        `⚠️ Program generation failed for ${client.name || maskPhone(client.phone)} — Week ${week_no}. Claude response couldn't be parsed.`
      );
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    // Safety check
    const nutrition = programData.nutrition_plan || {};
    if (nutrition.daily_calories && nutrition.daily_calories < 1200) {
      await sendText('+917082478374',
        `🚨 SAFETY FLAG: Generated program for ${client.name || maskPhone(client.phone)} has calories below 1200. Halted — needs manual review.`
      );
      return res.status(400).json({ error: 'Safety flag — calories too low' });
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(client, week_no, programData);

    // Upload to Supabase Storage
    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage.from('clients').upload(
      pdfPath,
      pdfBuffer,
      { contentType: 'application/pdf', upsert: true }
    );

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = db.storage.from('clients').getPublicUrl(pdfPath);

    // Save to programs table (audit trail)
    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: programData.workout_plan || programData.workout,
      nutrition_plan: programData.nutrition_plan || programData.nutrition,
      notes: `Auto-generated for Week ${week_no}`,
    }).select().single();

    // Send via WhatsApp
    const market = client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL';
    const contextNote = market === 'IN'
      ? `🎯 Week ${week_no} ka plan ready hai! Isme aapke last check-in ke basis pe adjustments kiye hain. PDF check karo aur questions ho toh batao 💪`
      : `🎯 Your Week ${week_no} plan is ready! It's been adjusted based on your latest check-in. Check the PDF and let us know if you have questions 💪`;

    await sendText(client.phone, contextNote);

    // Update whatsapp_sent_at
    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    await db.from('messages').insert({
      phone: client.phone,
      direction: 'out',
      body: `Week ${week_no} program PDF sent`,
      template_name: 'program_delivery',
      sent_at: new Date().toISOString(),
      status: 'sent',
    });

    console.log(`Program generated: ${maskPhone(client.phone)} Week ${week_no}`);
    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: publicUrl?.publicUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fillColor(gold).text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(12).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75);
    doc.fontSize(10).fillColor('#999999')
      .text(`Prepared for ${client.name || 'Client'} | ${new Date().toLocaleDateString()}`, 50, 95);

    doc.moveDown(4);

    // Workout Plan
    const workout = programData.workout_plan || programData.workout || {};
    doc.fontSize(18).fillColor(gold).text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
    doc.moveDown(0.5);

    const days = workout.days || [];
    for (const day of days) {
      if (doc.y > 700) doc.addPage();

      doc.fontSize(13).fillColor(charcoal)
        .text(`${day.day} — ${day.focus || ''}`, 50);
      doc.moveDown(0.3);

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        doc.fontSize(10).fillColor('#444444')
          .text(`  • ${ex.name}  —  ${ex.sets || '?'}×${ex.reps || '?'}  (Rest: ${ex.rest || '60s'})`, 60);
        if (ex.notes) {
          doc.fontSize(8).fillColor('#888888').text(`    ${ex.notes}`, 70);
        }
      }
      doc.moveDown(0.5);
    }

    // Nutrition Plan
    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(18).fillColor(gold).text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
    doc.moveDown(0.5);

    const nutrition = programData.nutrition_plan || programData.nutrition || {};

    if (nutrition.daily_calories) {
      doc.fontSize(11).fillColor(charcoal)
        .text(`Daily Target: ${nutrition.daily_calories} kcal  |  P: ${nutrition.protein_g || '?'}g  |  C: ${nutrition.carbs_g || '?'}g  |  F: ${nutrition.fats_g || '?'}g`, 50);
      doc.moveDown(0.5);
    }

    const meals = nutrition.meals || [];
    for (const meal of meals) {
      doc.fontSize(12).fillColor(charcoal).text(meal.meal || meal.name || '', 50);
      const options = meal.options || [];
      for (const opt of options) {
        doc.fontSize(10).fillColor('#444444').text(`  • ${opt}`, 60);
      }
      doc.moveDown(0.3);
    }

    if (nutrition.supplements) {
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor(charcoal).text('Supplements:', 50);
      const supps = Array.isArray(nutrition.supplements) ? nutrition.supplements : [nutrition.supplements];
      for (const s of supps) {
        doc.fontSize(10).fillColor('#444444').text(`  • ${s}`, 60);
      }
    }

    if (nutrition.hydration) {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#444444').text(`Hydration: ${nutrition.hydration}`, 50);
    }

    // Footer
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('#999999')
      .text('This program is personalized for you. Do not share. For support: support@fitnessbymaddy.com', 50, doc.y, { align: 'center' });

    doc.end();
  });
}
