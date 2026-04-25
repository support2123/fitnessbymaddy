const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');

const UNSAFE_PATTERNS = [
  /below\s*\d{3,4}\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*(in|per)\s*(a\s*)?week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeFile } = await supabase.storage
      .from('clients')
      .download(`intake/${client.lead_id}.json`);
    let intake = {};
    if (intakeFile) {
      try { intake = JSON.parse(await intakeFile.text()); } catch {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const prompt = buildPrompt(client, checkins || [], intake, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = message.content[0].text;

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(content)) {
        await supabase.from('escalations').insert({
          phone: client.phone,
          reason: 'unsafe_program_content',
          message_body: `Week ${week_no} program flagged: ${pattern.toString()}`
        });
        await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', [
          maskPhone(client.phone), 'Program flagged for unsafe content'
        ]);
        return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
      }
    }

    let workoutPlan, nutritionPlan;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        workoutPlan = parsed.workout_plan || parsed.workout;
        nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
      } else {
        workoutPlan = { raw: content };
        nutritionPlan = {};
      }
    } catch {
      workoutPlan = { raw: content };
      nutritionPlan = {};
    }

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf', upsert: true
    });

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);

    const { data: program } = await supabase.from('programs').insert({
      client_id, week_no,
      pdf_url: urlData.publicUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: `Generated for ${client.name || maskPhone(client.phone)}`
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      urlData.publicUrl
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand.

Generate a Week ${weekNo} program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${intake.goal || 'General fitness'}
- Experience: ${intake.experience || 'Intermediate'}
- Injuries/Limitations: ${intake.injuries || 'None reported'}
- Diet Preference: ${intake.diet_pref || 'No preference'}
- Schedule: ${intake.schedule || 'Flexible'}
- Current Weight: ${intake.current_weight || lastCheckin?.weight || 'Unknown'}
- Target Weight: ${intake.target_weight || 'Not specified'}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}
- Focus: ${lastCheckin.next_week_focus || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

RULES:
- Never prescribe extreme calorie deficits (below 1200 cal for women, 1500 for men)
- Never suggest banned substances or SARMs
- Set realistic weekly goals (0.5-1kg loss or 0.25-0.5kg gain max)
- Adapt intensity based on compliance and energy scores
- Include progressive overload principles
- Provide exact sets, reps, rest periods
- Include warm-up and cool-down
- Nutrition: macros, meal timing, hydration

Return as JSON:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
      ], "warmup": "...", "cooldown": "..." }
    ],
    "rest_days": ["Sunday"],
    "weekly_note": "..."
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "hydration": "3-4L daily",
    "supplements": ["..."],
    "weekly_note": "..."
  }
}
\`\`\``;
}

function generatePDF(client, weekNo, workout, nutrition) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 72, { align: 'center' });
    doc.fontSize(10).fill('#C8B89A').text(client.name || 'Client', 50, 94, { align: 'center' });

    doc.moveDown(4);
    doc.fill('#2C2C2C');

    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);

    if (workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  ${ex.name}: ${ex.sets}x${ex.reps} | Rest: ${ex.rest || '60s'}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    } else if (workout.raw) {
      doc.fontSize(10).fill('#6B6B6B').text(workout.raw.slice(0, 2000), 50, doc.y, { width: 495 });
    }

    if (doc.y > 650) doc.addPage();

    doc.moveDown(1);
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);

    if (nutrition.calories) {
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Calories: ${nutrition.calories} | Protein: ${nutrition.protein_g}g | Carbs: ${nutrition.carbs_g}g | Fat: ${nutrition.fat_g}g`, 50);
      doc.moveDown(0.5);
    }

    if (nutrition.meals) {
      for (const meal of nutrition.meals) {
        doc.fontSize(11).fill('#2C2C2C').text(meal.meal, 50);
        if (meal.options) {
          for (const opt of meal.options) {
            doc.fontSize(10).fill('#6B6B6B').text(`  - ${opt}`, 60);
          }
        }
        doc.moveDown(0.3);
      }
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#C8B89A')
      .text('Generated by FitnessByMaddy Coaching System', 50, doc.page.height - 50, { align: 'center' });

    doc.end();
  });
}
