const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

const UNSAFE_PATTERNS = [
  /below\s*\d{3,4}\s*calori/i,
  /dnp|clenbuterol|anavar|trenbolone|sarm/i,
  /lose\s*\d+\s*(kg|lb|pound).*(day|2\s*day|3\s*day)/i,
  /crash\s*diet|starvation/i,
  /very\s*low\s*calorie/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

    // Get last 2 checkins for context
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get previous program if exists
    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    // Build Claude prompt
    const prompt = buildProgramPrompt(client, checkins || [], prevPrograms || [], week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: SYSTEM_PROMPT
    });

    const content = response.content[0].text;

    // Safety check
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(content)) {
        await escalateToMaddy(
          'unsafe_program_content',
          client.phone,
          `Week ${week_no} program flagged: ${pattern.toString()}`
        );
        return res.json({ success: false, reason: 'flagged_for_review' });
      }
    }

    // Parse the JSON response
    let programData;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      programData = JSON.parse(jsonStr);
    } catch (parseErr) {
      programData = {
        workout_plan: { raw: content },
        nutrition_plan: {},
        notes: 'Auto-parsed from raw response'
      };
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(client, programData, week_no);

    // Upload PDF to Supabase storage
    const pdfPath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Save to programs table
    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan || {},
        nutrition_plan: programData.nutrition_plan || {},
        notes: programData.notes || null
      })
      .select('id')
      .single();

    // Send via WhatsApp
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const msg = hinglish
      ? `Week ${week_no} ka program ready hai! 📋💪\n\n${programData.notes || 'Is hafte focus rakhna — consistency is key!'}\n\nPDF: ${pdfUrl}`
      : `Your Week ${week_no} program is ready! 📋💪\n\n${programData.notes || 'Stay focused this week — consistency is key!'}\n\nPDF: ${pdfUrl}`;

    const sendResult = await sendWhatsApp({ phone: client.phone, body: msg });

    // Update whatsapp_sent_at
    if (sendResult.sent && program) {
      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.json({ success: true, program_id: program?.id, pdf_url: pdfUrl });

  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const SYSTEM_PROMPT = `You are "Program Architect" for Fitness by Maddy — an elite online fitness coach (NASM CPT, Nutrition Coach, Corrective Exercise Specialist).

Your job: generate a weekly workout + nutrition plan for a client based on their profile and recent check-in data.

Rules:
- Evidence-based programming only. No bro-science.
- Never recommend below 1200 calories for women or 1500 for men.
- Never recommend banned substances, SARMs, or aggressive supplementation.
- Progressive overload principles — build on the previous week.
- If the client reports pain or injury, reduce load and flag it.
- Keep plans realistic (4-6 training days, manageable meal prep).
- Respond ONLY with valid JSON in the format below.

Output format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": "3x 20min LISS or 2x HIIT sessions",
    "deload_note": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_framework": [
      { "meal": "Breakfast", "example": "Oats + protein + banana", "macros": "P:40 C:50 F:10" }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D"]
  },
  "notes": "One-liner context for the week"
}
\`\`\``;

function buildProgramPrompt(client, checkins, prevPrograms, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Started: ${client.program_started_at}\n\n`;

  if (checkins.length > 0) {
    prompt += `Recent check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      prompt += '\n';
    }
    prompt += '\n';
  } else {
    prompt += `No previous check-ins (this is week 1).\n\n`;
  }

  if (prevPrograms.length > 0) {
    prompt += `Previous week plan summary:\n`;
    const prev = prevPrograms[0];
    if (prev.notes) prompt += `Notes: ${prev.notes}\n`;
    prompt += '\n';
  }

  prompt += `Generate the next week's program. Ensure progressive overload from previous week if applicable.`;
  return prompt;
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fillColor('#999999')
      .text(`${client.name || 'Client'} · ${client.program}`, 50, 95, { align: 'center' });

    doc.moveDown(3);

    // Workout Plan
    doc.fillColor('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, 150);
    doc.moveTo(50, 172).lineTo(545, 172).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(1);

    let y = 185;
    const wp = programData.workout_plan;

    if (wp && wp.days) {
      for (const day of wp.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
              .text(`• ${ex.name}: ${ex.sets} × ${ex.reps} (rest ${ex.rest})`, 70, y);
            y += 16;
            if (ex.notes) {
              doc.fillColor('#666666').fontSize(9)
                .text(`  ${ex.notes}`, 85, y);
              y += 14;
            }
          }
        }
        y += 10;
      }
    }

    if (wp && wp.cardio) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica-Bold')
        .text(`Cardio: ${wp.cardio}`, 50, y);
      y += 25;
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    const np = programData.nutrition_plan;
    doc.fillColor('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 22;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#B8965A').lineWidth(2).stroke();
    y += 15;

    if (np) {
      if (np.calories) {
        doc.fillColor('#2C2C2C').fontSize(11).font('Helvetica-Bold')
          .text(`Daily Target: ${np.calories} kcal | P: ${np.protein_g}g | C: ${np.carbs_g}g | F: ${np.fat_g}g`, 50, y);
        y += 25;
      }

      if (np.meal_framework) {
        for (const meal of np.meal_framework) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fillColor('#B8965A').fontSize(10).font('Helvetica-Bold')
            .text(meal.meal, 50, y);
          doc.fillColor('#2C2C2C').fontSize(10).font('Helvetica')
            .text(meal.example, 150, y);
          if (meal.macros) {
            doc.fillColor('#999999').fontSize(9)
              .text(meal.macros, 400, y);
          }
          y += 18;
        }
      }

      y += 10;
      if (np.hydration) {
        doc.fillColor('#666666').fontSize(10).font('Helvetica')
          .text(`Hydration: ${np.hydration}`, 50, y);
        y += 16;
      }
      if (np.supplements && np.supplements.length) {
        doc.fillColor('#666666').fontSize(10)
          .text(`Supplements: ${np.supplements.join(', ')}`, 50, y);
      }
    }

    // Footer
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#CCCCCC').fontSize(8)
        .text('Fitness by Maddy · fitnessbymaddy.com · For personal use only', 50, 780, { align: 'center' });
    }

    doc.end();
  });
}
