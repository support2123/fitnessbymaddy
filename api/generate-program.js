const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { parseBody } = require('../lib/helpers');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /steroid/i,
  /lose\s*\d{2,}\s*kg.*(?:week|7 days)/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = await parseBody(req);

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();
    const prompt = buildPrompt(client, recentCheckins || [], week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const fullText = JSON.stringify(parsed);
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(fullText)) {
        const { escalateToMaddy } = require('../lib/escalate');
        await escalateToMaddy(
          client.phone,
          `Unsafe content in generated program (week ${week_no})`,
          `Pattern matched: ${pattern.toString()}`,
          client.id
        );
        return res.status(400).json({ error: 'Program flagged for review', pattern: pattern.toString() });
      }
    }

    const pdfBuffer = await generatePdf(client, parsed, week_no);

    const filePath = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: parsed.workout_plan || parsed.workout || {},
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
        notes: parsed.notes || null
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      parsed.notes || `Week ${week_no} program is ready!`
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `You are a certified fitness program architect for FitnessByMaddy. Generate a weekly training and nutrition plan.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'unknown'}
- Injuries/limitations: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'no preference'}
- Schedule: ${client.schedule || 'flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (Week 1)'}

Generate WEEK ${weekNo} program. Return ONLY valid JSON:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20min incline walk"
      }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 75,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily"
  },
  "notes": "One-liner context for WhatsApp message"
}

RULES:
- Never prescribe below 1400 calories for women or 1600 for men
- Never recommend banned substances or extreme protocols
- Adapt based on check-in data (injuries, energy, compliance)
- Be specific with exercise names, sets, reps, rest periods
- Include warm-up and cool-down recommendations`;
}

function generatePdf(client, plan, weekNo) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75);
    doc.fontSize(10).fill('#999999')
      .text(`Generated ${new Date().toLocaleDateString('en-IN')}`, 50, 95);

    doc.moveDown(3);

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const workout = plan.workout_plan || plan.workout || {};
    const days = workout.days || [];

    for (const day of days) {
      doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus || ''}`, 50);
      doc.moveDown(0.3);

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        doc.fontSize(10).fill('#2C2C2C')
          .text(`  • ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60);
        if (ex.notes) {
          doc.fontSize(9).fill('#666666').text(`    ${ex.notes}`, 70);
        }
      }

      if (day.cardio) {
        doc.fontSize(10).fill('#666666').text(`  Cardio: ${day.cardio}`, 60);
      }
      doc.moveDown(0.5);
    }

    if (workout.rest_days) {
      doc.fontSize(10).fill('#999999').text(`Rest days: ${workout.rest_days.join(', ')}`, 50);
    }

    doc.addPage();

    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, 20);

    doc.moveDown(2);

    const nutrition = plan.nutrition_plan || plan.nutrition || {};

    doc.fontSize(12).fill('#2C2C2C')
      .text(`Daily Targets: ${nutrition.calories || '—'} cal  |  P: ${nutrition.protein_g || '—'}g  |  C: ${nutrition.carbs_g || '—'}g  |  F: ${nutrition.fat_g || '—'}g`, 50);
    doc.moveDown(0.8);

    const meals = nutrition.meals || [];
    for (const meal of meals) {
      doc.fontSize(12).fill('#B8965A').text(meal.meal || '', 50);
      const options = meal.options || [];
      for (const opt of options) {
        doc.fontSize(10).fill('#2C2C2C').text(`  • ${opt}`, 60);
      }
      doc.moveDown(0.3);
    }

    if (nutrition.supplements) {
      doc.moveDown(0.5);
      doc.fontSize(12).fill('#B8965A').text('Supplements', 50);
      for (const s of nutrition.supplements) {
        doc.fontSize(10).fill('#2C2C2C').text(`  • ${s}`, 60);
      }
    }

    if (nutrition.hydration) {
      doc.moveDown(0.3);
      doc.fontSize(10).fill('#666666').text(`Hydration: ${nutrition.hydration}`, 50);
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);
    doc.fontSize(8).fill('#999999')
      .text('Generated by FitnessByMaddy Coaching System. For questions, message us on WhatsApp.', 50);

    doc.end();
  });
}
