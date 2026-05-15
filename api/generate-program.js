const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    // Get client profile
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get intake data from lead
    let intakeData = {};
    if (client.lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .single();
      try {
        intakeData = JSON.parse(lead?.first_msg || '{}');
      } catch { intakeData = {}; }
    }

    // Build Claude prompt
    const systemPrompt = `You are "Program Architect" for Fitness by Maddy, an elite online fitness coaching brand. You generate personalized weekly workout and nutrition plans.

RULES:
- Programs must be safe, evidence-based, and appropriate for the client's level
- Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Never promise specific weight loss timelines
- Account for injuries, medical conditions, and preferences
- Be progressive: increase intensity/volume week over week appropriately
- Output valid JSON only`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Intake data: ${JSON.stringify(intakeData)}

RECENT CHECK-INS:
${checkins?.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues="${c.issues || 'none'}"`).join('\n') || 'No check-ins yet (Week 1)'}

Output a JSON object with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": "3x per week, 20 min moderate intensity",
    "rest_days": ["Wednesday", "Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "suggestion": "Oats with protein powder, banana, almonds", "macros": "400 cal | 30P 50C 12F" },
      ...
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "Brief coaching note for this week",
  "safety_flag": false
}

Set safety_flag to true if anything in the client data suggests they need medical clearance first.`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].text;
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Invalid program generation response' });
    }

    // Safety check
    if (programData.safety_flag) {
      const { escalateToMaddy } = require('./lib/escalate');
      await escalateToMaddy(
        'Safety flag on generated program',
        `Client ${client_id} week ${week_no} — review before sending`
      );
      // Still save but don't auto-send
      await db.from('programs').upsert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.notes + ' [SAFETY FLAG — PENDING REVIEW]',
      }, { onConflict: 'client_id,week_no' });

      return res.status(200).json({ action: 'safety_flagged', client_id, week_no });
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(client, week_no, programData);

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    // Get public URL
    const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || '';

    // Save to programs table (audit trail)
    await db.from('programs').upsert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
      pdf_url: pdfUrl,
    }, { onConflict: 'client_id,week_no' });

    // Send via WhatsApp
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const msgParams = hinglish
      ? [`🔥 Week ${week_no} program ready hai! ${programData.notes || ''}`]
      : [`🔥 Your Week ${week_no} program is ready! ${programData.notes || ''}`];

    await sendWhatsApp(client.phone, 'weekly_program', msgParams, pdfUrl);

    // Update whatsapp_sent_at
    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    console.log(`Program generated: client=${maskPhone(client.phone)} week=${week_no}`);

    return res.status(200).json({ action: 'program_generated', client_id, week_no, pdf_url: pdfUrl });
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

    const BLACK = '#1a1a1a';
    const GOLD = '#B8965A';
    const GREY = '#6B6B6B';

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill(BLACK);
    doc.fontSize(10).fill(GOLD).text('FITNESS BY MADDY', 50, 30, { characterSpacing: 4 });
    doc.fontSize(24).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 55);
    doc.fontSize(11).fill(GOLD).text(
      `${client.name || 'Client'} — ${(client.program || '').toUpperCase()}`,
      50, 90
    );

    doc.moveDown(3);
    let y = 150;

    // Workout Plan
    doc.fontSize(14).fill(GOLD).text('WORKOUT PLAN', 50, y);
    y += 30;

    const workout = programData.workout_plan;
    if (workout?.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(11).fill(BLACK).text(`${day.day} — ${day.focus}`, 50, y);
        y += 18;

        for (const ex of day.exercises || []) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(9).fill(GREY)
            .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 50, y);
          y += 14;
          if (ex.notes) {
            doc.fontSize(8).fill(GOLD).text(`    ${ex.notes}`, 50, y);
            y += 12;
          }
        }
        y += 10;
      }
    }

    if (workout?.cardio) {
      doc.fontSize(9).fill(GREY).text(`Cardio: ${workout.cardio}`, 50, y);
      y += 20;
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    doc.fontSize(14).fill(GOLD).text('NUTRITION PLAN', 50, y);
    y += 25;

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      doc.fontSize(10).fill(BLACK)
        .text(`Calories: ${nutrition.calories} kcal  |  Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fat: ${nutrition.fat_g}g`, 50, y);
      y += 22;

      for (const meal of nutrition.meals || []) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fontSize(10).fill(BLACK).text(meal.meal, 50, y);
        doc.fontSize(9).fill(GREY).text(`  ${meal.suggestion}`, 50, y + 14);
        doc.fontSize(8).fill(GOLD).text(`  ${meal.macros}`, 50, y + 26);
        y += 42;
      }

      if (nutrition.hydration) {
        doc.fontSize(9).fill(GREY).text(`Hydration: ${nutrition.hydration}`, 50, y);
        y += 16;
      }

      if (nutrition.supplements?.length) {
        doc.fontSize(9).fill(GREY).text(`Supplements: ${nutrition.supplements.join(', ')}`, 50, y);
        y += 16;
      }
    }

    // Coach notes
    if (programData.notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.fontSize(12).fill(GOLD).text('COACH NOTES', 50, y);
      y += 20;
      doc.fontSize(10).fill(BLACK).text(programData.notes, 50, y, { width: 500 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(GREY)
        .text('© Fitness by Maddy — For personal use only', 50, doc.page.height - 40, {
          width: doc.page.width - 100,
          align: 'center',
        });
    }

    doc.end();
  });
}
