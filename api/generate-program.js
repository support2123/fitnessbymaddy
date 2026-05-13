const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'sarm', 'steroid', 'ephedrine',
  'lose 10kg in a week', 'lose 20 pounds in a week'
];

function checkSafety(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

async function generateWithClaude(client, checkins, weekNo) {
  const anthropic = new Anthropic();

  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prompt = `You are Maddy's program architect — a certified NASM trainer and nutrition coach.

Generate Week ${weekNo} training and nutrition plan for this client:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Current week: ${weekNo} of 12

Recent check-in data:
${checkinSummary || 'No previous check-ins (Week 1)'}

Output a JSON object with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": "3x/week, 20min LISS post-workout"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 73,
    "meals": [
      { "meal": "Breakfast", "options": ["Oats with whey protein and banana", "Egg whites with toast"], "time": "8:00 AM" }
    ],
    "supplements": ["Whey Protein", "Creatine 5g", "Vitamin D3"],
    "hydration": "3-4L water daily"
  },
  "notes": "One-liner context note for WhatsApp message"
}

Rules:
- Be specific and actionable
- Progressive overload from previous weeks
- Minimum 1200 calories for women, 1500 for men
- No banned substances or extreme protocols
- Adjust based on compliance and energy scores`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');
  return JSON.parse(jsonMatch[0]);
}

function renderPDF(plan, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const BLACK = '#1a1a1a';
    const GOLD = '#B8965A';
    const WHITE = '#FFFFFF';
    const GREY = '#6B6B6B';

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill(BLACK);
    doc.fontSize(10).fillColor(GOLD).text('FITNESS BY MADDY', 40, 30, { characterSpacing: 4 });
    doc.fontSize(28).fillColor(WHITE).text(`WEEK ${weekNo} PROGRAM`, 40, 55);
    doc.fontSize(11).fillColor(GREY).text(`${client.name || 'Client'} | 12-Week Custom`, 40, 92);

    let y = 140;

    // Workout Plan
    doc.fontSize(14).fillColor(GOLD).text('WORKOUT PLAN', 40, y);
    y += 25;

    if (plan.workout_plan?.days) {
      for (const day of plan.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 40; }
        doc.fontSize(11).fillColor(BLACK).text(day.day.toUpperCase() + ' — ' + day.focus, 40, y);
        y += 18;
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(9).fillColor(GREY).text(
              `  ${ex.name}  |  ${ex.sets} sets x ${ex.reps}  |  Rest: ${ex.rest}`,
              50, y
            );
            y += 14;
          }
        }
        y += 8;
      }
    }

    if (plan.workout_plan?.cardio) {
      doc.fontSize(9).fillColor(GREY).text(`Cardio: ${plan.workout_plan.cardio}`, 40, y);
      y += 20;
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 40; }
    doc.fontSize(14).fillColor(GOLD).text('NUTRITION PLAN', 40, y);
    y += 25;

    const np = plan.nutrition_plan;
    if (np) {
      doc.fontSize(10).fillColor(BLACK).text(
        `Calories: ${np.calories}  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`,
        40, y
      );
      y += 22;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) { doc.addPage(); y = 40; }
          doc.fontSize(10).fillColor(BLACK).text(`${meal.meal} (${meal.time})`, 40, y);
          y += 15;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fillColor(GREY).text(`  → ${opt}`, 50, y);
              y += 13;
            }
          }
          y += 5;
        }
      }

      if (np.supplements?.length) {
        y += 5;
        doc.fontSize(10).fillColor(BLACK).text('Supplements: ' + np.supplements.join(', '), 40, y);
        y += 15;
      }
      if (np.hydration) {
        doc.fontSize(9).fillColor(GREY).text(np.hydration, 40, y);
      }
    }

    // Footer
    const lastPage = doc.bufferedPageRange();
    doc.fontSize(8).fillColor(GREY).text(
      'fitnessbymaddy.com | This plan is personalised — do not share.',
      40, doc.page.height - 30
    );

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
  if (!client) return res.status(404).json({ error: 'Client not found' });

  // Get last 2 check-ins
  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .not('form_submitted_at', 'is', null)
    .order('week_no', { ascending: false })
    .limit(2);

  // Generate program via Claude
  let plan;
  try {
    plan = await generateWithClaude(client, checkins || [], week_no);
  } catch (err) {
    console.error(`Program generation failed for ${maskPhone(client.phone)}:`, err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  // Safety check
  const planText = JSON.stringify(plan);
  const safetyIssue = checkSafety(planText);
  if (safetyIssue) {
    await notifyMaddy(
      'Program flagged for review',
      `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nFlag: "${safetyIssue}"\nPlan halted — manual review required.`
    );
    await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: `FLAGGED: ${safetyIssue} — awaiting manual review`
    });
    return res.status(200).json({ status: 'flagged', reason: safetyIssue });
  }

  // Render PDF
  const pdfBuffer = await renderPDF(plan, client, week_no);

  // Upload to Supabase Storage
  const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
  const { error: uploadErr } = await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true
  });

  if (uploadErr) {
    console.error('PDF upload error:', uploadErr);
    return res.status(500).json({ error: 'PDF upload failed' });
  }

  const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl;

  // Save to programs table
  await db.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: plan.workout_plan,
    nutrition_plan: plan.nutrition_plan,
    notes: plan.notes || null
  });

  // Send via WhatsApp
  const contextNote = plan.notes || `Week ${week_no} program ready!`;
  await sendTemplate(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no),
    contextNote
  ], pdfUrl);

  // Update whatsapp_sent_at
  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ success: true, pdf_url: pdfUrl });
};
