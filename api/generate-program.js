const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/phone');

const BANNED_CONTENT = [
  'dnp', 'clenbuterol', 'ephedra', 'steroids', 'sarms',
  'below 1000 calories', 'below 800 calories', 'crash diet',
  'extreme fasting', 'water only', 'laxative'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
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
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram ? prevProgram[0] : null, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const flagged = checkBannedContent(JSON.stringify(parsed));
    if (flagged) {
      const { notifyMaddy } = require('../lib/whatsapp');
      await notifyMaddy(
        'Program safety flag',
        `Client ${maskPhone(client.phone)} week ${week_no}: ${flagged}`
      );
      return res.status(422).json({ error: 'Program flagged for review', flag: flagged });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData ? urlData.publicUrl : pdfPath;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || parsed.workouts || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || parsed.coach_note || ''
    }).select().single();

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [
        client.name || 'there',
        `Week ${week_no}`,
        parsed.notes || parsed.coach_note || 'Your new plan is ready!'
      ]
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prevSummary = prevProgram
    ? `Previous workout plan: ${JSON.stringify(prevProgram.workout_plan)}\nPrevious nutrition: ${JSON.stringify(prevProgram.nutrition_plan)}`
    : 'No previous program (Week 1)';

  return `You are an expert fitness program architect for FitnessByMaddy.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Current week: ${weekNo}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

PREVIOUS PROGRAM:
${prevSummary}

TASK: Generate Week ${weekNo} training + nutrition plan.

RULES:
- Progressive overload from previous week where applicable
- Adjust based on compliance score and energy levels
- If compliance < 6, simplify the plan
- If energy < 5, reduce volume by 15-20%
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Include rest day guidance
- Practical meal options (Indian + international mix)

OUTPUT FORMAT (respond ONLY with this JSON, no other text):
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "rest_day_guidance": "..."
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "One-liner coach note for WhatsApp message"
}
\`\`\``;
}

function checkBannedContent(text) {
  const lower = text.toLowerCase();
  for (const term of BANNED_CONTENT) {
    if (lower.includes(term)) return term;
  }
  const calMatch = lower.match(/(\d+)\s*(?:cal|kcal|calories)/);
  if (calMatch && parseInt(calMatch[1]) < 1000) {
    return `dangerously low calories: ${calMatch[1]}`;
  }
  return null;
}

async function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 72);
    doc.fill('rgba(255,255,255,0.6)').fontSize(10)
      .text(`${client.name || 'Client'} | ${client.program}`, 50, 92);

    doc.moveDown(3);
    let y = 150;

    // Workout Plan
    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    const workout = plan.workout_plan || plan.workouts || {};
    const days = workout.days || [];

    for (const day of days) {
      if (y > 700) { doc.addPage(); y = 50; }

      doc.rect(50, y, 495, 24).fill('#F0EAE0');
      doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold')
        .text(`${day.day} — ${day.focus || ''}`, 58, y + 6);
      y += 30;

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        if (y > 740) { doc.addPage(); y = 50; }
        doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
          .text(`• ${ex.name}`, 60, y);
        doc.fill('#6B6B6B')
          .text(`${ex.sets}×${ex.reps} | Rest: ${ex.rest || '60s'}`, 300, y);
        if (ex.notes) {
          y += 14;
          doc.fill('#B8965A').fontSize(9)
            .text(`  ${ex.notes}`, 70, y);
        }
        y += 18;
      }
      y += 10;
    }

    if (workout.rest_day_guidance) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fill('#B8965A').fontSize(10).font('Helvetica-Bold')
        .text('Rest Day:', 50, y);
      doc.fill('#6B6B6B').font('Helvetica')
        .text(workout.rest_day_guidance, 120, y, { width: 420 });
      y += 30;
    }

    // Nutrition Plan
    doc.addPage();
    y = 50;

    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    const nutrition = plan.nutrition_plan || plan.nutrition || {};

    doc.rect(50, y, 495, 50).fill('#2C2C2C');
    doc.fill('#FFFFFF').fontSize(11).font('Helvetica-Bold');
    const macroY = y + 10;
    doc.text(`${nutrition.daily_calories || '—'} kcal`, 70, macroY);
    doc.text(`P: ${nutrition.protein_g || '—'}g`, 200, macroY);
    doc.text(`C: ${nutrition.carbs_g || '—'}g`, 300, macroY);
    doc.text(`F: ${nutrition.fat_g || '—'}g`, 400, macroY);
    y += 65;

    const meals = nutrition.meals || [];
    for (const meal of meals) {
      if (y > 700) { doc.addPage(); y = 50; }

      doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold')
        .text(meal.meal || '', 50, y);
      y += 16;

      const options = meal.options || [];
      for (const opt of options) {
        if (y > 740) { doc.addPage(); y = 50; }
        doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
          .text(`→ ${opt}`, 60, y, { width: 480 });
        y += 16;
      }
      y += 10;
    }

    if (nutrition.hydration) {
      doc.fill('#6B6B6B').fontSize(10)
        .text(`Hydration: ${nutrition.hydration}`, 50, y);
      y += 20;
    }

    // Footer
    doc.fill('#B8965A').fontSize(8)
      .text('Generated by FitnessByMaddy Automation', 50, 780, { align: 'center' });

    doc.end();
  });
}
