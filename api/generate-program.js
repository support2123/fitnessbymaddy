const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /less than\s*1[0-2]00\s*cal/i,
  /clenbuterol/i, /dnp/i, /ephedrine/i, /sarm/i, /steroid/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i,
  /extreme\s*(cut|deficit|fast)/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    try {
      const { data: file } = await db.storage
        .from('intake-forms')
        .download(`${client.lead_id}.json`);
      if (file) {
        intakeData = JSON.parse(await file.text());
      }
    } catch {}

    const prompt = buildPrompt(client, recentCheckins || [], intakeData, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(content)) {
        await db.from('programs').insert({
          client_id,
          week_no,
          workout_plan: { raw: content },
          nutrition_plan: {},
          notes: `FLAGGED FOR REVIEW: matched pattern ${pattern.source}`
        });

        const { sendWhatsApp: sendWA } = require('../lib/whatsapp');
        await sendWA('+917082478374', 'escalation_alert', [
          'PROGRAM SAFETY FLAG',
          `Client: ${client.name}`,
          `Week ${week_no} program flagged for manual review`,
          `Pattern: ${pattern.source}`
        ]);

        return res.json({ action: 'flagged_for_review', week_no });
      }
    }

    const { workoutPlan, nutritionPlan, notes } = parsePlans(content);

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan, notes);

    const pdfPath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    let pdfUrl = null;
    if (!uploadErr) {
      const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
      pdfUrl = urlData.publicUrl;
    }

    const { data: program } = await db.from('programs').upsert({
      client_id,
      week_no,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
      pdf_url: pdfUrl
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (pdfUrl) {
      await sendWhatsApp(client.phone, 'weekly_program', [
        client.name || 'there',
        `Week ${week_no}`,
        notes || 'Keep pushing!'
      ], pdfUrl);

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    return res.json({ action: 'generated', program_id: program.id, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  let context = `You are a certified personal trainer and nutrition coach creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
`;

  if (intake) {
    context += `- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Injuries/limitations: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_pref || 'no preference'}
- Schedule: ${intake.schedule || 'flexible'}
- Experience: ${intake.experience || 'unknown'}
- Current weight: ${intake.current_weight || 'unknown'}
- Height: ${intake.height || 'unknown'}
- Medical notes: ${intake.medical || 'none'}
`;
  }

  if (checkins.length > 0) {
    context += '\nRECENT CHECK-INS:\n';
    for (const c of checkins) {
      context += `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10`;
      if (c.issues) context += `, Issues: ${c.issues}`;
      if (c.next_week_focus) context += `, Focus: ${c.next_week_focus}`;
      context += '\n';
    }
  }

  context += `
OUTPUT FORMAT — respond with valid JSON only, no markdown:
{
  "workout_plan": {
    "overview": "brief weekly overview",
    "days": [
      {"day": "Monday", "focus": "muscle group", "exercises": [
        {"name": "exercise", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""}
      ]},
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": "cardio prescription"
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meal_timing": ["meal 1 description", "meal 2", ...],
    "hydration": "water target",
    "supplements": ["if any"]
  },
  "notes": "1-2 sentence motivational/contextual note for this week"
}

RULES:
- Be progressive: adjust based on check-in data
- Never prescribe calories below 1400 for women or 1600 for men
- No banned substances, no extreme protocols
- Keep it evidence-based and safe
- If injuries are noted, work around them explicitly`;

  return context;
}

function parsePlans(content) {
  try {
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```json?\n?/, '').replace(/```$/, '').trim();
    }
    const parsed = JSON.parse(cleaned);
    return {
      workoutPlan: parsed.workout_plan || {},
      nutritionPlan: parsed.nutrition_plan || {},
      notes: parsed.notes || ''
    };
  } catch {
    return {
      workoutPlan: { raw: content },
      nutritionPlan: {},
      notes: 'Program generated — see full plan attached.'
    };
  }
}

function generatePDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 75);
    doc.fontSize(11).fill('#D4AF7A').text(`${client.name || 'Client'} | ${(client.program || '').replace(/_/g, ' ').toUpperCase()}`, 50, 95);

    doc.moveDown(4);

    if (notes) {
      doc.fontSize(11).fill('#6B6B6B').text(notes, 50);
      doc.moveDown(1.5);
    }

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.8);

    if (workout.overview) {
      doc.fontSize(10).fill('#6B6B6B').text(workout.overview);
      doc.moveDown(0.8);
    }

    if (workout.days) {
      for (const day of workout.days) {
        if (doc.y > 680) doc.addPage();
        doc.fontSize(13).fill('#B8965A').text(day.day + (day.focus ? ` — ${day.focus}` : ''));
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}${ex.notes ? '  |  ' + ex.notes : ''}`, 60);
          }
        }
        doc.moveDown(0.6);
      }
    } else if (workout.raw) {
      doc.fontSize(10).fill('#2C2C2C').text(workout.raw.slice(0, 2000), 50);
    }

    if (doc.y > 550) doc.addPage();

    doc.moveDown(1.5);
    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.8);

    if (nutrition.daily_calories) {
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Target: ${nutrition.daily_calories} kcal  |  P: ${nutrition.protein_g || '?'}g  |  C: ${nutrition.carbs_g || '?'}g  |  F: ${nutrition.fats_g || '?'}g`);
      doc.moveDown(0.5);
    }

    if (nutrition.meal_timing) {
      for (let i = 0; i < nutrition.meal_timing.length; i++) {
        doc.fontSize(10).fill('#6B6B6B').text(`Meal ${i + 1}: ${nutrition.meal_timing[i]}`, 60);
      }
      doc.moveDown(0.5);
    }

    if (nutrition.hydration) {
      doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${nutrition.hydration}`);
    }

    if (nutrition.supplements && nutrition.supplements.length) {
      doc.fontSize(10).fill('#6B6B6B').text(`Supplements: ${nutrition.supplements.join(', ')}`);
    }

    doc.moveDown(3);
    doc.fontSize(8).fill('#C8B89A').text('Generated by Fitness by Maddy | fitnessbymaddy.com', 50, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}
