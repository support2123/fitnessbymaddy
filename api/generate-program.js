const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 calories', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: lastProgram } = await db
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic();

    const prompt = buildProgramPrompt(client, recentCheckins || [], lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    // Safety check
    const lower = content.toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => lower.includes(f));
    if (flagged) {
      const { sendTemplate } = require('../lib/whatsapp');
      const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';
      await sendTemplate(MADDY_PHONE, 'escalation_alert', [
        'Program safety flag',
        client.phone?.slice(-4) || 'unknown',
      ]);
      return res.json({ success: false, reason: 'flagged_for_review' });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(content);
      workoutPlan = parsed.workout_plan || parsed.workout;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: content };
      nutritionPlan = {};
      notes = '';
    }

    const { data: program, error } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
      pdf_url: null,
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) {
      console.error('Program save error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    // Generate and upload PDF
    const pdfUrl = await generateAndUploadPdf(db, client, program, week_no);

    if (pdfUrl) {
      await db.from('programs').update({ pdf_url: pdfUrl }).eq('id', program.id);

      const msg = `Week ${week_no} program is ready! 💪\n${notes ? `Focus: ${notes}\n` : ''}📄 ${pdfUrl}`;
      await sendText(client.phone, msg);

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('id', program.id);
    }

    return res.json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues=${c.issues || 'none'}`
  ).join('\n');

  return `You are a NASM-certified fitness program architect for FitnessByMaddy.

Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

Recent Check-ins:
${checkinSummary || 'No prior check-ins (Week 1)'}

${lastProgram ? `Last Week's Focus: ${lastProgram.notes || 'General fitness'}` : ''}

Generate a complete weekly program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": { "type": "LISS", "duration": "20min" }
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meal_plan": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "One sentence coach note for the week"
}

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances
- Base progression on check-in data (increase load if compliance high, deload if energy low)
- Keep it practical and science-backed`;
}

async function generateAndUploadPdf(db, client, program, weekNo) {
  try {
    const html = buildPdfHtml(client, program, weekNo);
    const pdfBuffer = await htmlToPdf(html);

    if (!pdfBuffer) return null;

    const path = `${client.id}/week_${weekNo}.pdf`;
    const { error } = await db.storage.from('clients').upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    if (error) {
      console.error('PDF upload error:', error.message);
      return null;
    }

    const { data: urlData } = db.storage.from('clients').getPublicUrl(path);
    return urlData?.publicUrl || null;
  } catch (err) {
    console.error('PDF generation error:', err.message);
    return null;
  }
}

function buildPdfHtml(client, program, weekNo) {
  const workout = program.workout_plan || {};
  const nutrition = program.nutrition_plan || {};
  const days = workout.days || workout.raw ? [{ day: 'Program', focus: 'See details', exercises: [] }] : [];

  let exerciseRows = '';
  if (Array.isArray(days)) {
    for (const day of days) {
      exerciseRows += `<tr class="day-header"><td colspan="5">${day.day} — ${day.focus || ''}</td></tr>`;
      if (Array.isArray(day.exercises)) {
        for (const ex of day.exercises) {
          exerciseRows += `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`;
        }
      }
      if (day.cardio) {
        exerciseRows += `<tr class="cardio"><td colspan="5">Cardio: ${day.cardio.type} — ${day.cardio.duration}</td></tr>`;
      }
    }
  }

  const meals = Array.isArray(nutrition.meal_plan) ? nutrition.meal_plan.map(m =>
    `<div class="meal"><strong>${m.meal}:</strong> ${Array.isArray(m.options) ? m.options.join(' / ') : m.options || ''}</div>`
  ).join('') : '';

  return `<!DOCTYPE html>
<html>
<head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
  .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #B8965A; padding-bottom: 20px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: #B8965A; letter-spacing: 4px; }
  .header p { color: #999; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: #B8965A; margin: 30px 0 15px; letter-spacing: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
  th { background: #B8965A; color: #1a1a1a; padding: 10px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  td { padding: 8px 10px; border-bottom: 1px solid #333; font-size: 13px; }
  .day-header td { background: #2a2a2a; font-weight: 600; color: #B8965A; font-size: 14px; padding: 12px 10px; }
  .cardio td { color: #999; font-style: italic; }
  .nutrition-box { background: #2a2a2a; padding: 20px; border-radius: 4px; margin-bottom: 20px; }
  .macros { display: flex; gap: 20px; margin-bottom: 15px; }
  .macro { text-align: center; flex: 1; padding: 10px; background: #1a1a1a; border-radius: 4px; }
  .macro-num { font-size: 24px; font-weight: 600; color: #B8965A; }
  .macro-label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; }
  .meal { padding: 8px 0; border-bottom: 1px solid #333; font-size: 13px; }
  .footer { text-align: center; margin-top: 40px; color: #666; font-size: 11px; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <p>${client.name || 'Client'} — Week ${weekNo} Program</p>
  </div>

  <h2 class="section-title">Workout Plan</h2>
  <table>
    <thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr></thead>
    <tbody>${exerciseRows}</tbody>
  </table>

  <h2 class="section-title">Nutrition Plan</h2>
  <div class="nutrition-box">
    <div class="macros">
      <div class="macro"><div class="macro-num">${nutrition.calories || '—'}</div><div class="macro-label">Calories</div></div>
      <div class="macro"><div class="macro-num">${nutrition.protein_g || '—'}g</div><div class="macro-label">Protein</div></div>
      <div class="macro"><div class="macro-num">${nutrition.carbs_g || '—'}g</div><div class="macro-label">Carbs</div></div>
      <div class="macro"><div class="macro-num">${nutrition.fats_g || '—'}g</div><div class="macro-label">Fats</div></div>
    </div>
    ${meals}
  </div>

  ${program.notes ? `<p style="color:#B8965A;margin-top:20px;">Coach Note: ${program.notes}</p>` : ''}

  <div class="footer">
    <p>FITNESS BY MADDY &bull; fitnessbymaddy.com &bull; Confidential — Do Not Distribute</p>
  </div>
</body>
</html>`;
}

async function htmlToPdf(html) {
  try {
    const chromium = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
    });
    await browser.close();
    return pdf;
  } catch (err) {
    console.error('Puppeteer PDF error:', err.message);
    return null;
  }
}
