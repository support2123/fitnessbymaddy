const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'banned substance', 'steroid',
  'crash diet', 'lose 10 pounds in a week', 'dehydration',
  'diuretic', 'laxative', 'starvation',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
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

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect — an expert NASM-certified personal trainer and nutrition coach. Generate a week's workout and nutrition plan for a client.

Rules:
- Be evidence-based. No bro-science.
- Never recommend extreme calorie deficits (min 1200 kcal women, 1500 kcal men).
- Never recommend banned substances or crash diets.
- Consider injuries, diet preferences, and schedule constraints.
- Output valid JSON only with keys: workout_plan, nutrition_plan, notes.

workout_plan format: { days: [{ day: "Monday", focus: "Upper Body", exercises: [{ name, sets, reps, rest, notes }] }] }
nutrition_plan format: { daily_calories, protein_g, carbs_g, fat_g, meals: [{ meal: "Breakfast", options: ["..."] }], supplements: ["..."] }`;

    const userPrompt = `Client profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries: ${client.injuries || 'None reported'}
- Diet preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Flexible'}

Week ${week_no} of ${client.program === '12wk' ? 12 : 6}.

${recentCheckins?.length ? `Recent check-ins:\n${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins.'}

${prevProgram ? `Previous week plan notes: ${prevProgram.notes || 'None'}` : 'First week — start with assessment-level intensity.'}

Generate the complete Week ${week_no} program as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');

    const plan = JSON.parse(jsonMatch[0]);
    const planStr = JSON.stringify(plan).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => planStr.includes(flag));

    if (flagged) {
      await escalateToMaddy({
        reason: 'Program flagged for safety review',
        phone: client.phone,
        details: `Week ${week_no} program contains potentially risky content. Review before sending.`,
      });
      return res.json({ success: false, reason: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, plan);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) console.error('Upload error:', uploadError.message);

    const { data: urlData } = db.storage.from('programs').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program, error: insertError } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: plan.workout_plan,
        nutrition_plan: plan.nutrition_plan,
        notes: plan.notes || null,
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    const contextNote = plan.notes || `Week ${week_no} program ready. Let's crush it!`;
    await sendWhatsApp({
      phone: client.phone,
      body: `Your Week ${week_no} program is ready!\n\n${contextNote}\n\nPDF: ${pdfUrl}`,
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', maskPhone(client_id), err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

async function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 75);
    doc.fontSize(10).fill('#D4AF7A').text(`${client.name || 'Client'} | ${(client.program || '').replace(/_/g, ' ').toUpperCase()}`, 50, 95);

    doc.moveDown(3);

    if (plan.workout_plan?.days) {
      doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', { underline: true });
      doc.moveDown(0.5);

      for (const day of plan.workout_plan.days) {
        doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus}`);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C')
              .text(`  ${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest || '60s'}${ex.notes ? ` | ${ex.notes}` : ''}`);
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (plan.nutrition_plan) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(1);
      doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', { underline: true });
      doc.moveDown(0.5);

      const np = plan.nutrition_plan;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Target: ${np.daily_calories || '—'} kcal | P: ${np.protein_g || '—'}g | C: ${np.carbs_g || '—'}g | F: ${np.fat_g || '—'}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).fill('#B8965A').text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#2C2C2C').text(`  • ${opt}`);
            }
          }
          doc.moveDown(0.3);
        }
      }
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#999999').text('Generated by FitnessByMaddy Coaching System', { align: 'center' });

    doc.end();
  });
}
