const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getClient } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { escalateToMaddy } = require('../lib/escalation');

const BANNED_TERMS = [
  'steroids', 'sarms', 'clenbuterol', 'dnp', 'ephedra',
  'under 800 calories', 'under 900 calories', 'under 1000 calories',
  'crash diet', 'extreme fasting', 'water fast',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const sb = getClient();

    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await sb
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const { data: checkins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect for FitnessByMaddy. Generate a weekly workout and nutrition plan.
Output ONLY valid JSON with this structure:
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
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-liner context for the client"
}

Rules:
- Never recommend banned substances or extreme calorie restriction (minimum 1200 cal for women, 1500 for men)
- Adapt based on check-in data (compliance, energy, weight trends)
- Be progressive: increase intensity gradually
- Account for injuries and limitations from intake form
- Keep it practical for the client's schedule and equipment access`;

    const userPrompt = `Client: ${client.name || 'Unknown'}
Program: ${client.program}
Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}

Intake data: ${JSON.stringify(intake || {}, null, 2)}

Last 2 check-ins: ${JSON.stringify(checkins || [], null, 2)}

Generate week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;
    let programData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('[GEN_PROGRAM] Failed to parse Claude response');
      await escalateToMaddy('Program generation failed - invalid output', {
        phone: client.phone, name: client.name, message: `Week ${week_no} generation failed`,
      });
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const outputStr = JSON.stringify(programData).toLowerCase();
    const hasBannedContent = BANNED_TERMS.some(term => outputStr.includes(term));
    if (hasBannedContent) {
      await escalateToMaddy('Program contains flagged content - needs manual review', {
        phone: client.phone, name: client.name,
        message: `Week ${week_no} flagged for banned content`,
      });
      return res.status(200).json({ status: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await sb.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) console.error('[PDF_UPLOAD]', uploadErr.message);

    const { data: urlData } = sb.storage.from('client-files').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || '';

    const { error: insertErr } = await sb.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || '',
    });

    if (insertErr) console.error('[GEN_PROGRAM_DB]', insertErr.message);

    const contextNote = programData.notes || `Your Week ${week_no} program is ready!`;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      contextNote,
    ]);
    await logMessage(client.phone, 'out', `Week ${week_no} program sent`, 'weekly_program');

    await sb.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    console.log(`[GEN_PROGRAM] Week ${week_no} for ${maskPhone(client.phone)}`);
    return res.status(200).json({ status: 'generated', pdf_url: pdfUrl });
  } catch (err) {
    console.error('[GEN_PROGRAM]', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 72);
    doc.fontSize(10).fill('#D4AF7A').text(client.name || '', 50, 92);

    doc.moveDown(3);

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const wp = programData.workout_plan;
    if (wp && wp.days) {
      for (const day of wp.days) {
        doc.fontSize(13).fill('#B8965A').text(day.day.toUpperCase() + (day.focus ? ` — ${day.focus}` : ''), 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60);
            if (ex.notes) doc.fontSize(8).fill('#6B6B6B').text(`    ${ex.notes}`, 70);
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (wp && wp.cardio) {
      doc.fontSize(10).fill('#6B6B6B').text(`Cardio: ${wp.cardio}`, 50);
      doc.moveDown(0.5);
    }

    if (doc.y > 600) doc.addPage();

    doc.moveDown(1);
    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).fill('#B8965A').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill('#2C2C2C').text(`  → ${opt}`, 60);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.3);
        doc.fontSize(9).fill('#6B6B6B').text(`Hydration: ${np.hydration}`, 50);
      }
    }

    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill('#2C2C2C');
    doc.fontSize(8).fill('#B8965A')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 28);

    doc.end();
  });
}
