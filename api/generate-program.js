const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendMediaMessage } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/utils');

const SAFETY_FLAGS = [
  /under\s*800\s*cal/i,
  /\b(dnp|clenbuterol|sarm|steroid|ephedra)\b/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*(in|per)\s*(a\s*)?week/i,
  /starv|extreme\s*fast|zero\s*carb\s*for\s*weeks/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const { data: recentCheckins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await db.from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      totalWeeks: client.program === '12wk' ? 12 : 6,
      intake: lead?.intake_data || {},
      recentCheckins: (recentCheckins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues
      }))
    };

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: buildPrompt(clientProfile)
      }]
    });

    const aiText = response.content[0].text;

    for (const flag of SAFETY_FLAGS) {
      if (flag.test(aiText)) {
        const { escalateToMaddy } = require('./lib/escalation');
        await escalateToMaddy('Safety flag in generated program', client, `Week ${week_no}: ${flag.toString()}`);
        return res.status(200).json({ ok: false, reason: 'safety_flagged', week_no });
      }
    }

    let parsed;
    try {
      const jsonMatch = aiText.match(/```json\s*([\s\S]*?)```/) || aiText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : aiText);
    } catch {
      parsed = { workout_plan: { raw: aiText }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const filePath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage.from('clients').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    if (uploadError) {
      console.error('[generate-program] Upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage.from('clients').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || parsed.workout || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || null
    });

    const caption = `Week ${week_no} program ready! ${parsed.notes || 'Check your personalized plan inside.'}`;
    await sendMediaMessage(client.phone, pdfUrl, caption, true);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    console.log(`[program-gen] ${maskPhone(client.phone)} week ${week_no} done`);
    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('[generate-program] Error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(profile) {
  const checkinContext = profile.recentCheckins.length > 0
    ? `Recent check-ins:\n${profile.recentCheckins.map(c =>
        `  Week ${c.week}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
      ).join('\n')}`
    : 'No previous check-ins yet (first week).';

  return `You are a certified fitness program architect for Fitness by Maddy.

CLIENT PROFILE:
- Name: ${profile.name}
- Program: ${profile.program} (Week ${profile.week} of ${profile.totalWeeks})
- Age: ${profile.intake.age || 'unknown'}
- Gender: ${profile.intake.gender || 'unknown'}
- Goal: ${profile.intake.goal || 'general fitness'}
- Injuries: ${profile.intake.injuries || 'none reported'}
- Diet preference: ${profile.intake.diet_preference || 'no preference'}
- Experience: ${profile.intake.experience_level || 'intermediate'}
- Equipment: ${profile.intake.equipment_access || 'full gym'}
- Schedule: ${profile.intake.schedule || '5 days/week'}

${checkinContext}

Generate a complete Week ${profile.week} program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }
      ]}
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": "...",
    "hydration": "..."
  },
  "notes": "One-liner summary for WhatsApp message"
}

RULES:
- Science-backed, progressive overload from previous weeks
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Adjust based on compliance score and reported issues
- Keep it practical and achievable`;
}

async function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    if (plan.workout_plan?.days) {
      doc.fontSize(18).font('Helvetica-Bold').fill('#B8965A').text('WORKOUT PLAN');
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
      doc.moveDown(0.5);

      for (const day of plan.workout_plan.days) {
        if (doc.y > 700) { doc.addPage(); doc.y = 50; }
        doc.fontSize(13).font('Helvetica-Bold').fill('#2C2C2C').text(`${day.day} — ${day.focus}`);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).font('Helvetica').fill('#6B6B6B')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}${ex.notes ? '  |  ' + ex.notes : ''}`, { indent: 10 });
          }
        }
        doc.moveDown(0.5);
      }

      if (plan.workout_plan.cardio) {
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').fill('#6B6B6B')
          .text(`Cardio: ${plan.workout_plan.cardio}`);
      }
    }

    doc.moveDown(1.5);
    if (plan.nutrition_plan) {
      if (doc.y > 600) { doc.addPage(); doc.y = 50; }
      doc.fontSize(18).font('Helvetica-Bold').fill('#B8965A').text('NUTRITION PLAN');
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
      doc.moveDown(0.5);

      const np = plan.nutrition_plan;
      if (np.calories) {
        doc.fontSize(11).font('Helvetica-Bold').fill('#2C2C2C')
          .text(`Daily Targets: ${np.calories} kcal  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fat_g}g`);
        doc.moveDown(0.5);
      }
      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).font('Helvetica-Bold').fill('#2C2C2C').text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).font('Helvetica').fill('#6B6B6B').text(`  • ${opt}`, { indent: 10 });
            }
          }
          doc.moveDown(0.3);
        }
      }
      if (np.supplements) {
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').fill('#6B6B6B').text(`Supplements: ${np.supplements}`);
      }
      if (np.hydration) {
        doc.fontSize(10).font('Helvetica').fill('#6B6B6B').text(`Hydration: ${np.hydration}`);
      }
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#C8B89A')
        .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 40, { align: 'center' });
    }

    doc.end();
  });
}
