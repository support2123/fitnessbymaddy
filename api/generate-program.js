const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

    const { data: intake } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .maybeSingle();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const prompt = buildPrompt(client, intake, recentCheckins, prevPrograms, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    if (hasSafetyIssue(content)) {
      await notifyMaddy(
        'Program safety flag',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nFlagged content detected — manual review needed.`
      );
      return res.json({ success: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: urlData.publicUrl,
        workout_plan: parsed.workout_plan || {},
        nutrition_plan: parsed.nutrition_plan || {},
        notes: parsed.coach_notes || null,
        generated_at: new Date().toISOString()
      })
      .select()
      .single();

    const contextNote = parsed.coach_notes
      || `Week ${week_no} program ready — stay consistent!`;

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'Champion',
      templateParams: [contextNote],
      media: { url: urlData.publicUrl, filename: `week_${week_no}.pdf` }
    }, true);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.json({ success: true, program_id: program.id, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'generation failed' });
  }
};

function buildPrompt(client, intake, checkins, prevPrograms, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
  ).join('\n') || 'No previous check-ins.';

  const prevPlan = prevPrograms?.[0]
    ? `Last week plan summary: ${JSON.stringify(prevPrograms[0].workout_plan).substring(0, 500)}`
    : 'No previous program.';

  return `You are Maddy's program architect — an expert fitness coach creating Week ${weekNo} of a 12-week personalised training program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intake ? `- Age: ${intake.age}, Gender: ${intake.gender}
- Goal: ${intake.goal}
- Experience: ${intake.experience}
- Current weight: ${intake.current_weight}kg, Target: ${intake.target_weight}kg
- Height: ${intake.height}cm
- Injuries/limitations: ${intake.injuries || 'None'}
- Diet preference: ${intake.diet_pref || 'No restriction'}
- Schedule: ${intake.schedule || 'Flexible'}` : '- No intake form data available.'}

RECENT CHECK-INS:
${checkinSummary}

PREVIOUS PROGRAM:
${prevPlan}

INSTRUCTIONS:
- Design a complete 7-day workout plan with exercises, sets, reps, rest periods
- Create a daily nutrition plan with meals, macros, and calories
- Progress from last week based on check-in data
- If compliance was low, simplify slightly
- If energy was low, reduce volume by 10-15%
- Add a brief coach note (1-2 sentences, warm and motivating)

SAFETY RULES (NEVER violate):
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend any banned or controlled substances
- Never promise specific weight loss timelines
- If client reported pain/injury, modify around it

Return valid JSON:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..."}] }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 0,
    "macros": {"protein_g": 0, "carbs_g": 0, "fat_g": 0},
    "meals": [{"meal": "Breakfast", "options": ["..."], "macros": "..."}]
  },
  "coach_notes": "..."
}`;
}

function hasSafetyIssue(content) {
  const lower = content.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 100).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 30);
    doc.fill('#FFFFFF').fontSize(14).text(`Week ${weekNo} Program`, 50, 65);
    doc.fill('#999999').fontSize(10).text(client.name || 'Client', 400, 35);
    doc.text(new Date().toLocaleDateString('en-IN'), 400, 50);

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    // Coach Notes
    if (plan.coach_notes) {
      doc.fontSize(12).fill('#B8965A').text('FROM YOUR COACH', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(11).fill('#333333').text(plan.coach_notes);
      doc.moveDown(1.5);
    }

    // Workout Plan
    doc.fontSize(16).fill('#2C2C2C').text('WORKOUT PLAN');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const days = plan.workout_plan?.days || [];
    for (const day of days) {
      if (doc.y > 700) doc.addPage();
      doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus || ''}`);
      doc.moveDown(0.3);
      for (const ex of (day.exercises || [])) {
        doc.fontSize(10).fill('#333333')
          .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}${ex.notes ? '  |  ' + ex.notes : ''}`);
      }
      doc.moveDown(0.8);
    }

    // Nutrition Plan
    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(16).fill('#2C2C2C').text('NUTRITION PLAN');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const np = plan.nutrition_plan || {};
    if (np.daily_calories) {
      doc.fontSize(11).fill('#333333')
        .text(`Daily Calories: ${np.daily_calories} kcal`);
    }
    if (np.macros) {
      doc.text(`Macros: Protein ${np.macros.protein_g}g | Carbs ${np.macros.carbs_g}g | Fat ${np.macros.fat_g}g`);
    }
    doc.moveDown(0.5);

    for (const meal of (np.meals || [])) {
      if (doc.y > 700) doc.addPage();
      doc.fontSize(11).fill('#B8965A').text(meal.meal);
      for (const opt of (meal.options || [])) {
        doc.fontSize(10).fill('#333333').text(`  ${opt}`);
      }
      doc.moveDown(0.5);
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fill('#999999')
      .text('This program is personalised for you. Do not redistribute.', { align: 'center' });
    doc.text('www.fitnessbymaddy.com', { align: 'center' });

    doc.end();
  });
}
