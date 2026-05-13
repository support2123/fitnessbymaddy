const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/mask-phone');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.fitnessbymaddy.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const GOLD = '#B8965A';
const BLACK = '#2C2C2C';
const BANNED_SUBSTANCES = [
  'steroid', 'clenbuterol', 'dnp', 'ephedra', 'sarm', 'hgh',
  'testosterone', 'anavar', 'dianabol', 'trenbolone',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing required fields: client_id, week_no' });
    }

    // 1. Fetch client data
    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      console.error('Client not found:', clientErr?.message);
      return res.status(404).json({ error: 'Client not found' });
    }

    // 2. Fetch last 2 checkins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // 3. Fetch intake submission for the client's lead
    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1);

    const intakeData = intake && intake.length > 0 ? intake[0] : null;

    // 4. Build Claude prompt
    const systemPrompt =
      'You are a certified personal trainer and nutrition coach. ' +
      'Create a detailed weekly workout and nutrition plan. ' +
      'Respond ONLY with valid JSON, no markdown, no explanation.';

    const userPrompt = buildUserPrompt(client, intakeData, checkins, week_no);

    // 5. Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let program;
    try {
      program = JSON.parse(rawText);
    } catch (parseErr) {
      // Try to extract JSON from potential markdown wrapping
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        program = JSON.parse(jsonMatch[0]);
      } else {
        console.error('Failed to parse Claude response as JSON');
        return res.status(500).json({ error: 'Failed to parse program response' });
      }
    }

    // 6. Safety check
    const safetyIssue = checkSafety(program, rawText);
    if (safetyIssue) {
      console.error(`Safety check failed: ${safetyIssue}`);
      await escalateToMaddy(`Program safety flag: ${safetyIssue}`, {
        phone: client.phone,
        name: client.name || 'Unknown',
        message: `Week ${week_no} program flagged — ${safetyIssue}`,
      });
      return res.status(422).json({ error: 'Program flagged for review', reason: safetyIssue });
    }

    // 7. Store in programs table
    const { data: programRow, error: insertErr } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Failed to insert program:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    // 8. Generate PDF and upload to Supabase Storage
    const pdfBuffer = await generatePDF(client, week_no, program);

    const storagePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('Failed to upload PDF:', uploadErr.message);
      // Continue without PDF — program is already saved
    }

    // Get public URL for the PDF
    let pdfUrl = null;
    if (!uploadErr) {
      const { data: urlData } = db.storage
        .from('programs')
        .getPublicUrl(storagePath);
      pdfUrl = urlData?.publicUrl || null;

      // Update programs row with pdf_url
      await db
        .from('programs')
        .update({ pdf_url: pdfUrl })
        .eq('id', programRow.id);
    }

    // 9. Send WhatsApp to client
    const focus = extractFocus(program);
    const whatsappMsg = pdfUrl
      ? `Your Week ${week_no} plan is ready! Focus this week: ${focus}\n\nDownload here: ${pdfUrl}`
      : `Your Week ${week_no} plan is ready! Focus this week: ${focus}\n\nPDF is being processed — you'll get it shortly.`;

    await sendWhatsApp(client.phone, whatsappMsg, 'program_ready');
    console.log(`Program generated for ${maskPhone(client.phone)}, week ${week_no}`);

    // 10. Return success
    return res.status(200).json({ ok: true, program_id: programRow.id });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildUserPrompt(client, intake, checkins, weekNo) {
  let prompt = `Create a Week ${weekNo} program for the following client:\n\n`;

  prompt += `**Client Profile:**\n`;
  prompt += `- Name: ${client.name || 'N/A'}\n`;

  if (intake) {
    prompt += `- Age: ${intake.age || 'N/A'}\n`;
    prompt += `- Gender: ${intake.gender || 'N/A'}\n`;
    prompt += `- Height: ${intake.height_cm ? intake.height_cm + ' cm' : 'N/A'}\n`;
    prompt += `- Weight: ${intake.weight_kg ? intake.weight_kg + ' kg' : 'N/A'}\n`;
    prompt += `- Goal: ${intake.goal || 'N/A'}\n`;
    prompt += `- Injuries/Limitations: ${intake.injuries || 'None'}\n`;
    prompt += `- Medical Conditions: ${intake.medical_conditions || 'None'}\n`;
    prompt += `- Diet Preference: ${intake.diet_preference || 'No preference'}\n`;
    prompt += `- Training Experience: ${intake.training_experience || 'N/A'}\n`;
    prompt += `- Available Equipment: ${intake.available_equipment || 'N/A'}\n`;
    prompt += `- Weekly Schedule: ${intake.weekly_schedule || 'N/A'}\n`;
  } else {
    prompt += `- Goal: ${client.goal || 'General fitness'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\n**Recent Check-in Data (last ${checkins.length} weeks):**\n`;
    for (const ci of checkins) {
      prompt += `- Week ${ci.week_no}: `;
      prompt += `Weight: ${ci.weight || 'N/A'} kg, `;
      prompt += `Compliance: ${ci.compliance_score || 'N/A'}/10, `;
      prompt += `Energy: ${ci.energy || 'N/A'}/10, `;
      prompt += `Issues: ${ci.issues || 'None'}\n`;
    }
  }

  prompt += `\nRespond with a JSON object containing:\n`;
  prompt += `{\n`;
  prompt += `  "workout_plan": {\n`;
  prompt += `    "days": [\n`;
  prompt += `      {\n`;
  prompt += `        "day": "Monday",\n`;
  prompt += `        "focus": "Upper Body",\n`;
  prompt += `        "exercises": [\n`;
  prompt += `          { "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "..." }\n`;
  prompt += `        ]\n`;
  prompt += `      }\n`;
  prompt += `    ]\n`;
  prompt += `  },\n`;
  prompt += `  "nutrition_plan": {\n`;
  prompt += `    "daily_calories": 2000,\n`;
  prompt += `    "protein_g": 150,\n`;
  prompt += `    "carbs_g": 200,\n`;
  prompt += `    "fat_g": 70,\n`;
  prompt += `    "meals": [\n`;
  prompt += `      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }\n`;
  prompt += `    ],\n`;
  prompt += `    "notes": "..."\n`;
  prompt += `  }\n`;
  prompt += `}\n`;

  return prompt;
}

function checkSafety(program, rawText) {
  // Check extreme calorie cuts
  const calories = program?.nutrition_plan?.daily_calories;
  if (calories && calories < 1000) {
    return `Extreme calorie cut detected: ${calories} cal/day`;
  }

  // Check banned substances
  const lower = rawText.toLowerCase();
  for (const substance of BANNED_SUBSTANCES) {
    if (lower.includes(substance)) {
      return `Banned substance mentioned: ${substance}`;
    }
  }

  // Check unrealistic timelines
  const unrealisticPatterns = [
    /lose\s+\d{2,}\s*(kg|lbs?|pounds?)\s+in\s+(1|2|3)\s+week/i,
    /drop\s+\d{2,}\s*(kg|lbs?|pounds?)\s+in\s+(1|2|3)\s+week/i,
  ];
  for (const pattern of unrealisticPatterns) {
    if (pattern.test(rawText)) {
      return 'Unrealistic timeline detected in program';
    }
  }

  return null;
}

function extractFocus(program) {
  if (!program?.workout_plan?.days || program.workout_plan.days.length === 0) {
    return 'building consistency';
  }

  const focuses = program.workout_plan.days
    .map((d) => d.focus)
    .filter(Boolean);

  if (focuses.length === 0) return 'building consistency';

  const unique = [...new Set(focuses)];
  if (unique.length <= 3) return unique.join(' + ');
  return unique.slice(0, 3).join(', ') + ' and more';
}

function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 100).fill(BLACK);
    doc.fontSize(28).fillColor(GOLD).text('FITNESS BY MADDY', 50, 30, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF').text(`Week ${weekNo} Program`, 50, 65, { align: 'center' });

    doc.moveDown(3);

    // Client info
    doc.fontSize(10).fillColor('#666666');
    doc.text(`Client: ${client.name || 'N/A'}`, 50);
    doc.moveDown(0.5);

    // Workout section
    doc.moveDown(1);
    doc.fontSize(18).fillColor(GOLD).text('WORKOUT PLAN');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GOLD).stroke();
    doc.moveDown(0.5);

    if (program.workout_plan?.days) {
      for (const day of program.workout_plan.days) {
        // Check if we need a new page
        if (doc.y > 680) doc.addPage();

        doc.fontSize(13).fillColor(BLACK).text(`${day.day} — ${day.focus || ''}`, { underline: true });
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            const line = `  ${ex.name}: ${ex.sets} sets x ${ex.reps} reps (${ex.rest || '60s'} rest)`;
            doc.fontSize(10).fillColor('#333333').text(line);
            if (ex.notes) {
              doc.fontSize(9).fillColor('#888888').text(`    ${ex.notes}`);
            }
          }
        }
        doc.moveDown(0.5);
      }
    }

    // Nutrition section
    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(18).fillColor(GOLD).text('NUTRITION PLAN');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GOLD).stroke();
    doc.moveDown(0.5);

    const np = program.nutrition_plan;
    if (np) {
      doc.fontSize(11).fillColor(BLACK);
      doc.text(`Daily Calories: ${np.daily_calories || 'N/A'} kcal`);
      doc.text(`Protein: ${np.protein_g || 'N/A'}g  |  Carbs: ${np.carbs_g || 'N/A'}g  |  Fat: ${np.fat_g || 'N/A'}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          if (doc.y > 700) doc.addPage();

          doc.fontSize(12).fillColor(BLACK).text(meal.meal, { underline: true });
          doc.moveDown(0.2);

          if (meal.options) {
            for (const option of meal.options) {
              doc.fontSize(10).fillColor('#333333').text(`  - ${option}`);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.notes) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#666666').text(`Notes: ${np.notes}`);
      }
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#AAAAAA').text(
      'This plan was generated by FitnessByMaddy. Consult a physician before starting any exercise program.',
      50,
      doc.page.height - 50,
      { align: 'center' }
    );

    doc.end();
  });
}
