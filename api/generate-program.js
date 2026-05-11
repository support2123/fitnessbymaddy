const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const PDFDocument = require('pdfkit');

const UNSAFE_PATTERNS = [
  /below\s*\d{3,4}\s*cal/i,
  /extreme\s*(calorie|deficit)/i,
  /starvation/i,
  /banned\s*substance/i,
  /steroid/i,
  /ephedra/i,
  /dnp/i,
  /clenbuterol/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*per\s*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeData } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1);

    const prompt = buildProgramPrompt(client, recentCheckins || [], intakeData?.[0] || null, week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(responseText)) {
        const { escalateToMaddy } = require('./lib/escalation');
        await escalateToMaddy(
          client.phone,
          'Unsafe program content detected',
          `Week ${week_no}: matched pattern ${pattern.source}`
        );
        return res.status(200).json({
          success: false,
          reason: 'flagged_for_review',
          pattern: pattern.source,
        });
      }
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout_plan || parsed.workouts || null;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || null;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = null;
      notes = '';
    }

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan, notes);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = publicUrl?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
    });

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'Champion',
      String(week_no),
      notes ? notes.substring(0, 100) : 'Your new plan is ready!',
    ], pdfUrl);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, intake, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const intakeInfo = intake
    ? `Age: ${intake.age}, Goal: ${intake.goal}, Injuries: ${intake.injuries || 'none'}, Diet: ${intake.diet_preference || 'flexible'}, Equipment: ${intake.equipment_access || 'full gym'}, Experience: ${intake.experience_level || 'intermediate'}, Current weight: ${intake.current_weight || 'unknown'}kg, Target: ${intake.target_weight || 'not set'}kg`
    : 'No intake data available';

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
Name: ${client.name || 'Client'}
Program: ${client.program}
Week: ${weekNo}
${intakeInfo}

RECENT CHECK-INS:
${checkinSummary || 'No check-in data yet (first week)'}

INSTRUCTIONS:
- Create a complete workout plan for 5-6 training days
- Create a nutrition plan with daily calorie and macro targets
- Include warm-up and cool-down notes
- Be specific with exercises, sets, reps, and rest periods
- Adjust based on check-in trends (compliance, energy, weight changes)
- NEVER recommend extreme calorie deficits (below 1200 for women, 1500 for men)
- NEVER recommend banned substances or unrealistic timelines
- Keep it science-backed and sustainable

Return ONLY valid JSON in this format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [{ "name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }] }
    ],
    "warmup": "...",
    "cooldown": "..."
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": "...",
    "hydration": "...",
    "supplements": []
  },
  "notes": "One-liner coach note for the client"
}`;
}

async function generatePDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');

    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 30, { align: 'center' });

    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 70, { align: 'center' });

    doc.moveDown(3);

    doc.fontSize(18).fillColor('#2C2C2C')
      .text('WORKOUT PLAN', 50, 150);

    doc.moveTo(50, 175).lineTo(545, 175).strokeColor('#B8965A').lineWidth(2).stroke();

    let y = 190;

    if (workout?.days) {
      for (const day of workout.days) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        doc.fontSize(13).fillColor('#B8965A').text(`${day.day} — ${day.focus || ''}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) {
              doc.addPage();
              y = 50;
            }
            doc.fontSize(10).fillColor('#2C2C2C')
              .text(`• ${ex.name}  —  ${ex.sets} x ${ex.reps}  (Rest: ${ex.rest || '60s'})`, 70, y);
            y += 16;
          }
        }
        y += 10;
      }
    } else if (workout?.raw) {
      doc.fontSize(10).fillColor('#2C2C2C').text(workout.raw.substring(0, 2000), 50, y, { width: 495 });
      y = doc.y + 20;
    }

    if (y > 600) {
      doc.addPage();
      y = 50;
    }

    doc.fontSize(18).fillColor('#2C2C2C').text('NUTRITION PLAN', 50, y);
    y += 25;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#B8965A').lineWidth(2).stroke();
    y += 15;

    if (nutrition) {
      const macros = [
        `Daily Calories: ${nutrition.calories || '—'} kcal`,
        `Protein: ${nutrition.protein_g || '—'}g`,
        `Carbs: ${nutrition.carbs_g || '—'}g`,
        `Fat: ${nutrition.fat_g || '—'}g`,
      ];
      for (const line of macros) {
        doc.fontSize(11).fillColor('#2C2C2C').text(line, 70, y);
        y += 18;
      }
      if (nutrition.meal_timing) {
        y += 5;
        doc.fontSize(10).fillColor('#6B6B6B').text(`Meal Timing: ${nutrition.meal_timing}`, 70, y);
        y += 18;
      }
      if (nutrition.hydration) {
        doc.fontSize(10).fillColor('#6B6B6B').text(`Hydration: ${nutrition.hydration}`, 70, y);
        y += 18;
      }
    }

    if (notes) {
      y += 20;
      doc.fontSize(12).fillColor('#B8965A').text('COACH NOTE', 50, y);
      y += 18;
      doc.fontSize(10).fillColor('#2C2C2C').text(notes, 50, y, { width: 495 });
    }

    const pageBottom = doc.page.height - 40;
    doc.fontSize(8).fillColor('#C8B89A')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, pageBottom, { align: 'center' });

    doc.end();
  });
}
