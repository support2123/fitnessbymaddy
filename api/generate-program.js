const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 calories', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol',
  'lose 10kg in a week', 'crash diet', 'water fasting for weeks'
];

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

  try {
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
    const prompt = buildPrompt(client, recentCheckins || [], lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    const lower = content.toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (lower.includes(flag)) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy('Unsafe program content flagged', {
          phone: client.phone,
          name: client.name,
          message: `Week ${week_no} program contained: "${flag}"`
        });
        return res.json({ success: false, reason: 'safety_flagged', flag });
      }
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);
    const pdfPath = `${client_id}/week_${week_no}.pdf`;

    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || parsed,
      nutrition_plan: parsed.nutrition_plan || {},
      notes: parsed.coach_note || null
    });

    const market = detectMarket(client.phone);
    const template = isHinglish(market) ? 'weekly_program_hi' : 'weekly_program_en';

    await sendWhatsApp(client.phone, template, {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(week_no),
        parsed.coach_note || `Week ${week_no} program is ready!`
      ],
      media: { url: pdfUrl, filename: `Week_${week_no}_Program.pdf` }
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, checkins, lastProgram, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified fitness coach creating Week ${weekNo} of a 12-week personalized program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No restrictions'}
- Schedule Availability: ${client.schedule || 'Flexible'}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10` : ''}

${lastProgram ? `LAST PROGRAM NOTES: ${lastProgram.notes || 'N/A'}` : ''}

INSTRUCTIONS:
1. Create a progressive workout plan for the week (5-6 training days)
2. Create a nutrition plan with macros and meal suggestions
3. Include a short motivational coach note
4. Adjust intensity based on compliance and energy levels
5. Never suggest extreme calorie restriction (min 1200 kcal women, 1500 kcal men)
6. Never suggest any banned or dangerous substances
7. Keep recommendations evidence-based and safe

Return as JSON:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "coach_note": "One-liner motivational note for the week"
}
\`\`\``;
}

function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#D4AF7A').text(client.name || 'Client', 50, 95, { align: 'center' });

    doc.moveDown(3);

    if (program.workout_plan) {
      doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', { underline: true });
      doc.moveDown(0.5);

      const days = program.workout_plan.days || [];
      for (const day of days) {
        doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus || ''}`);
        doc.moveDown(0.3);

        const exercises = day.exercises || [];
        for (const ex of exercises) {
          doc.fontSize(10).fill('#2C2C2C')
            .text(`  • ${ex.name}: ${ex.sets}×${ex.reps} (Rest: ${ex.rest || '60s'})${ex.notes ? ' — ' + ex.notes : ''}`);
        }
        doc.moveDown(0.5);
      }

      if (program.workout_plan.cardio) {
        doc.fontSize(11).fill('#2C2C2C').text(`Cardio: ${program.workout_plan.cardio}`);
      }
    }

    doc.moveDown(1);

    if (program.nutrition_plan) {
      doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', { underline: true });
      doc.moveDown(0.5);

      const np = program.nutrition_plan;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Targets: ${np.calories || '—'} kcal | Protein: ${np.protein_g || '—'}g | Carbs: ${np.carbs_g || '—'}g | Fat: ${np.fat_g || '—'}g`);
      doc.moveDown(0.5);

      const meals = np.meals || [];
      for (const meal of meals) {
        doc.fontSize(12).fill('#B8965A').text(meal.meal);
        const options = meal.options || [];
        for (const opt of options) {
          doc.fontSize(10).fill('#2C2C2C').text(`  • ${opt}`);
        }
        doc.moveDown(0.3);
      }

      if (np.hydration) {
        doc.moveDown(0.3);
        doc.fontSize(10).fill('#2C2C2C').text(`Hydration: ${np.hydration}`);
      }
    }

    doc.moveDown(1);
    if (program.coach_note) {
      doc.fontSize(12).fill('#B8965A').text(`Coach's Note: ${program.coach_note}`, { italic: true });
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#999999').text('Generated by Fitness by Maddy coaching system. For personal use only.', { align: 'center' });

    doc.end();
  });
}
