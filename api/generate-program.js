const { supabase } = require('../lib/supabase');
const { sendText, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function checkSafety(planText) {
  const lower = (typeof planText === 'string' ? planText : JSON.stringify(planText)).toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generateWithClaude(client, checkins) {
  const anthropic = new Anthropic();

  const lastTwo = checkins.slice(-2);
  const checkinSummary = lastTwo.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  const prompt = `You are a certified fitness program architect working for FitnessByMaddy, a premium online coaching brand.

Client Profile:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}

Recent Check-ins:
${checkinSummary || 'No previous check-ins (Week 1)'}

Generate a comprehensive weekly program with:
1. WORKOUT PLAN: 5-6 days of training, with exercise name, sets, reps, rest periods, and RPE targets. Include warmup and cooldown.
2. NUTRITION PLAN: Daily calorie target, macro split (protein/carbs/fats), 3 meal ideas for each meal (breakfast, lunch, dinner, snack).
3. NOTES: One motivational note and one coaching tip specific to their progress.

Rules:
- Never suggest calories below 1200 for women or 1500 for men
- Never recommend any banned or unsafe substances
- Be realistic with timelines — no "lose 10kg in a week" claims
- Adjust based on compliance score and energy levels from check-ins
- If low compliance, simplify the plan; if high compliance, push harder

Respond in JSON format:
{
  "workout_plan": { "days": [...] },
  "nutrition_plan": { "calories": number, "protein_g": number, "carbs_g": number, "fats_g": number, "meals": {...} },
  "notes": "string"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');
  return JSON.parse(jsonMatch[0]);
}

function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 75);
    doc.fontSize(10).fill('#999999').text(`Prepared for ${client.name}`, 50, 95);

    doc.moveDown(3);

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const workout = plan.workout_plan;
    if (workout && workout.days) {
      workout.days.forEach((day, i) => {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(13).fill('#B8965A').text(day.name || `Day ${i + 1}`, 50);
        doc.fontSize(10).fill('#2C2C2C');
        const exercises = day.exercises || [];
        exercises.forEach(ex => {
          const line = `  ${ex.name || ex.exercise} — ${ex.sets || '?'}x${ex.reps || '?'} @ RPE ${ex.rpe || '?'} (Rest: ${ex.rest || '60s'})`;
          doc.text(line, 60);
        });
        doc.moveDown(0.5);
      });
    }

    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const nutrition = plan.nutrition_plan;
    if (nutrition) {
      doc.fontSize(11).fill('#2C2C2C');
      doc.text(`Daily Calories: ${nutrition.calories || '—'} kcal`, 60);
      doc.text(`Protein: ${nutrition.protein_g || '—'}g | Carbs: ${nutrition.carbs_g || '—'}g | Fats: ${nutrition.fats_g || '—'}g`, 60);
      doc.moveDown(0.5);

      if (nutrition.meals) {
        Object.entries(nutrition.meals).forEach(([meal, options]) => {
          doc.fontSize(11).fill('#B8965A').text(meal.toUpperCase(), 60);
          doc.fontSize(10).fill('#2C2C2C');
          const items = Array.isArray(options) ? options : [options];
          items.forEach(item => {
            doc.text(`  • ${typeof item === 'string' ? item : JSON.stringify(item)}`, 70);
          });
          doc.moveDown(0.3);
        });
      }
    }

    if (plan.notes) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(1);
      doc.fontSize(18).fill('#2C2C2C').text('COACH NOTES', 50);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
      doc.moveDown(0.5);
      doc.fontSize(11).fill('#2C2C2C').text(plan.notes, 60, undefined, { width: 480 });
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#999999').text('This program is for the named client only. Not medical advice. Consult your doctor before starting any fitness program.', 50, undefined, { width: 480, align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: true });

    const plan = await generateWithClaude(client, checkins || []);

    if (checkSafety(plan)) {
      await notifyMaddy(
        `UNSAFE PROGRAM FLAGGED — ${maskPhone(client.phone)}`,
        `Client: ${client.name}\nWeek: ${week_no}\nPlan flagged for safety review. Auto-send halted.`
      );
      await supabase.from('programs').insert({
        client_id, week_no,
        workout_plan: plan.workout_plan || {},
        nutrition_plan: plan.nutrition_plan || {},
        notes: `FLAGGED FOR REVIEW: ${plan.notes || ''}`
      });
      return res.json({ success: false, reason: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, plan);
    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client_id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    let pdfUrl = null;
    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from('programs')
        .getPublicUrl(storagePath);
      pdfUrl = urlData?.publicUrl;
    }

    const { data: programRecord } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: plan.workout_plan || {},
      nutrition_plan: plan.nutrition_plan || {},
      notes: plan.notes || '',
      pdf_url: pdfUrl
    }).select().single();

    if (pdfUrl) {
      const msg = `Week ${week_no} program is ready! Here's your personalised plan: ${pdfUrl}`;
      await sendText(client.phone, msg);

      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', programRecord.id);
    }

    return res.json({ success: true, program_id: programRecord.id, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
