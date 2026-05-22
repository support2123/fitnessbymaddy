const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getClient } = require('../lib/supabase');
const { sendTemplateForced, maskPhone } = require('../lib/whatsapp');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /extreme\s*(calorie|deficit)/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|steroids?|sarms?/i,
  /lose\s*\d{2,}\s*(kg|lbs?|pounds?)\s*(in|per)\s*(a\s*)?week/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getClient();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: leadData } = client.lead_id
      ? await db.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const prompt = buildPrompt(client, leadData, recentCheckins || [], week_no);

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    let programData;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
        content.match(/\{[\s\S]*"workout_plan"[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      programData = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program from AI' });
    }

    const rawText = JSON.stringify(programData);
    const isRisky = RISKY_PATTERNS.some(p => p.test(rawText));
    if (isRisky) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        'Risky program content flagged',
        `Client ${maskPhone(client.phone)} Week ${week_no} — auto-halted for review`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || {},
        nutrition_plan: programData.nutrition_plan || {},
        notes: 'FLAGGED: Awaiting Maddy review',
        pdf_url: null
      });
      return res.status(200).json({ ok: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await db.from('programs').upsert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan || {},
      nutrition_plan: programData.nutrition_plan || {},
      notes: programData.notes || null,
      pdf_url: pdfUrl
    }, { onConflict: 'client_id,week_no' });

    await sendTemplateForced(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(week_no),
        pdfUrl
      ],
      media: {
        url: pdfUrl,
        filename: `Week_${week_no}_Program.pdf`
      }
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function buildPrompt(client, lead, checkins, weekNo) {
  const intake = lead?.intake_data || {};
  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  return `You are a certified fitness program architect for FitnessByMaddy.
Create a Week ${weekNo} program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${intake.goal || 'General fitness'}
- Experience: ${intake.experience_level || 'Intermediate'}
- Injuries/Limitations: ${intake.injuries || 'None reported'}
- Diet preference: ${intake.diet_pref || 'No preference'}
- Schedule: ${intake.workout_schedule || '5 days/week'}

${checkins.length > 0 ? `RECENT CHECK-IN DATA:
- Last weight: ${lastCheckin.weight || 'N/A'} | Prev: ${prevCheckin.weight || 'N/A'}
- Last waist: ${lastCheckin.waist || 'N/A'} | Prev: ${prevCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues reported: ${lastCheckin.issues || 'None'}
- Focus area: ${lastCheckin.next_week_focus || 'General improvement'}` : 'No previous check-ins yet (Week 1).'}

OUTPUT FORMAT: Return ONLY valid JSON with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "cardio": "20 min steady state"
      }
    ],
    "notes": "Progressive overload from last week"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fats_g": 70,
    "meals": [
      {"meal": "Breakfast", "options": ["Option 1", "Option 2"]}
    ],
    "notes": "Increase protein on training days"
  },
  "notes": "One-liner summary for WhatsApp"
}
\`\`\`

RULES:
- Never prescribe below 1400 calories for women or 1600 for men
- Never recommend banned supplements or extreme protocols
- If the client reported pain or injury, modify exercises accordingly
- Base progression on check-in data trends
- Keep meal options practical and aligned with diet preference`;
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 100).fill('#2C2C2C');
    doc.fill('#B8965A')
      .fontSize(28)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30, { align: 'left' });
    doc.fill('#FFFFFF')
      .fontSize(14)
      .font('Helvetica')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 65);

    doc.moveDown(2);
    let y = 130;

    // Workout Plan
    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    const days = programData.workout_plan?.days || [];
    for (const day of days) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fill('#B8965A').fontSize(13).font('Helvetica-Bold')
        .text(`${day.day} — ${day.focus || ''}`, 50, y);
      y += 20;

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        if (y > 730) { doc.addPage(); y = 50; }
        doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
          .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 50, y);
        y += 15;
      }

      if (day.cardio) {
        doc.fill('#6B6B6B').fontSize(10)
          .text(`  Cardio: ${day.cardio}`, 50, y);
        y += 15;
      }
      y += 10;
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    y += 10;
    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 25;

    const np = programData.nutrition_plan || {};
    doc.fill('#2C2C2C').fontSize(11).font('Helvetica')
      .text(`Daily Targets:  ${np.calories || '—'} cal  |  P: ${np.protein_g || '—'}g  |  C: ${np.carbs_g || '—'}g  |  F: ${np.fats_g || '—'}g`, 50, y);
    y += 25;

    const meals = np.meals || [];
    for (const meal of meals) {
      if (y > 730) { doc.addPage(); y = 50; }
      doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold')
        .text(meal.meal, 50, y);
      y += 16;
      const options = meal.options || [];
      for (const opt of options) {
        doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
          .text(`  • ${opt}`, 60, y);
        y += 14;
      }
      y += 6;
    }

    // Footer
    doc.fill('#B8965A').fontSize(8)
      .text('FitnessByMaddy.com | This program is personalized — do not share.', 50, 770, { align: 'center' });

    doc.end();
  });
}
