const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const supabase = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /banned\s*substance/i,
  /steroid/i,
  /clenbuterol/i,
  /dnp/i,
  /lose\s*\d{2,}\s*kg\s*in\s*\d\s*week/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
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

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create science-backed, personalised weekly workout and nutrition plans.
Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan".

workout_plan: object with keys for each day (day_1 through day_7). Each day has:
  - focus: string (e.g. "Upper Body Push", "Rest & Recovery")
  - exercises: array of { name, sets, reps, rest_seconds, notes }

nutrition_plan: object with:
  - daily_calories: number
  - protein_g: number
  - carbs_g: number
  - fat_g: number
  - meals: array of { meal_name, description, approx_calories }
  - notes: string

Rules:
- Never recommend under 1200 calories for women or 1500 for men
- Never recommend banned substances, steroids, or extreme protocols
- Base progressions on actual check-in data when available
- Include one full rest day minimum
- Keep language warm and encouraging (Hinglish touches for IN market clients)`;

    const userPrompt = `Generate Week ${week_no} program for client:
Name: ${client.name}
Program: ${client.program}
${recentCheckins?.length ? `Recent check-ins: ${JSON.stringify(recentCheckins)}` : 'No previous check-ins yet.'}
${prevProgram ? `Previous week plan notes: ${prevProgram.notes || 'None'}` : 'First week — build foundation.'}

Create a progressive, personalised plan for this specific week.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = message.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy('Program generation failed', `Could not parse JSON for ${maskPhone(client.phone)} week ${week_no}`);
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData);
    const isUnsafe = UNSAFE_PATTERNS.some(p => p.test(fullText));
    if (isUnsafe) {
      await escalateToMaddy(
        'Unsafe program content detected',
        `Week ${week_no} for ${maskPhone(client.phone)} flagged for review`
      );
      return res.status(200).json({ ok: false, flagged: true, reason: 'Content flagged for safety review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `${client.folder_url || 'clients/' + client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('[GenProgram] Upload error:', uploadErr.message);
    }

    const { data: publicUrl } = supabase.storage.from('programs').getPublicUrl(filePath);

    const { data: programRecord } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: publicUrl?.publicUrl || filePath,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: `Auto-generated week ${week_no}`
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      publicUrl?.publicUrl || 'Check your program folder'
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', programRecord.id);

    console.log(`[GenProgram] Week ${week_no} generated & sent for ${maskPhone(client.phone)}`);
    return res.status(200).json({ ok: true, program_id: programRecord.id });
  } catch (err) {
    console.error('[GenProgram] Error:', err.message);
    await escalateToMaddy('Program generation error', `${client_id} week ${week_no}: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill(gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75);
    doc.fontSize(10).fill('#CCCCCC')
      .text(`Prepared for ${client.name || 'Client'} | ${new Date().toLocaleDateString()}`, 50, 95);

    doc.moveDown(4);

    doc.fontSize(18).fill(charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
    doc.moveDown(0.5);

    const wp = programData.workout_plan || {};
    for (const [day, plan] of Object.entries(wp)) {
      if (doc.y > 700) doc.addPage();
      const dayLabel = day.replace('_', ' ').toUpperCase();
      doc.fontSize(13).fill(gold).font('Helvetica-Bold')
        .text(`${dayLabel}: ${plan.focus || ''}`, 50);
      doc.moveDown(0.3);

      if (plan.exercises) {
        for (const ex of plan.exercises) {
          doc.fontSize(10).fill(charcoal).font('Helvetica')
            .text(`  ${ex.name} — ${ex.sets}x${ex.reps} (${ex.rest_seconds || 60}s rest)${ex.notes ? ' | ' + ex.notes : ''}`, 60);
        }
      }
      doc.moveDown(0.5);
    }

    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(18).fill(charcoal).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
    doc.moveDown(0.5);

    const np = programData.nutrition_plan || {};
    doc.fontSize(11).fill(charcoal).font('Helvetica')
      .text(`Daily Target: ${np.daily_calories || '—'} kcal | Protein: ${np.protein_g || '—'}g | Carbs: ${np.carbs_g || '—'}g | Fat: ${np.fat_g || '—'}g`, 50);
    doc.moveDown(0.5);

    if (np.meals) {
      for (const meal of np.meals) {
        doc.fontSize(11).fill(gold).font('Helvetica-Bold')
          .text(`${meal.meal_name} (~${meal.approx_calories || '—'} kcal)`, 50);
        doc.fontSize(10).fill(charcoal).font('Helvetica')
          .text(`  ${meal.description || ''}`, 60);
        doc.moveDown(0.3);
      }
    }

    if (np.notes) {
      doc.moveDown(0.5);
      doc.fontSize(10).fill(charcoal).font('Helvetica-Oblique')
        .text(`Note: ${np.notes}`, 50);
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#999999')
      .text('Generated by FitnessByMaddy Coaching System. For personal use only.', 50, doc.y, { align: 'center' });

    doc.end();
  });
}
