const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./lib/supabase');
const { sendText, maskPhone } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroids', 'anabolic', 'sarm',
  'lose 10kg in a week', 'crash diet', 'water fast',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

  const { data: recentCheckins } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const anthropic = new Anthropic();

  const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy, an elite online coaching brand. Generate weekly customised workout and nutrition plans.

RULES:
- All recommendations must be evidence-based and safe
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, extreme protocols, or unrealistic timelines
- Consider injuries, dietary preferences, and compliance history
- Progressive overload: adjust based on previous week performance
- Be specific: exact exercises, sets, reps, rest periods, meal macros

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "summary": "brief overview",
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
      ]}
    ]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 130,
    "carbs_g": 200,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "coach_note": "A brief motivational note for the client"
}`;

  const userPrompt = buildUserPrompt(client, recentCheckins, week_no);

  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err.message);
    await notifyMaddy('Program generation failed', `Client: ${maskPhone(client.phone)}, Week ${week_no}: ${err.message}`);
    return res.status(500).json({ error: 'AI generation failed' });
  }

  const fullText = JSON.stringify(programData).toLowerCase();
  const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
  if (flagged) {
    await notifyMaddy(
      'Program flagged for safety review',
      `Client: ${maskPhone(client.phone)}, Week ${week_no}\nProgram halted — contains potentially unsafe content.`
    );
    return res.status(200).json({ status: 'flagged_for_review', client_id, week_no });
  }

  const pdfBuffer = await generatePDF(client, programData, week_no);

  const pdfPath = `${client_id}/week_${week_no}.pdf`;
  const { error: uploadErr } = await supabase.storage
    .from('clients')
    .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

  if (uploadErr) {
    console.error('PDF upload error:', uploadErr.message);
  }

  const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || '';

  await supabase.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.coach_note || '',
  });

  const coachNote = programData.coach_note || `Your Week ${week_no} program is ready!`;
  await sendText(
    client.phone,
    `📋 Week ${week_no} Program Ready!\n\n${coachNote}\n\n📥 Download: ${pdfUrl}`
  );

  await supabase.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ status: 'generated', client_id, week_no, pdf_url: pdfUrl });
};

function buildUserPrompt(client, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;
  if (client.age) prompt += `Age: ${client.age}\n`;
  if (client.goal) prompt += `Goal: ${client.goal}\n`;
  if (client.injuries) prompt += `Injuries/Limitations: ${client.injuries}\n`;
  if (client.diet_pref) prompt += `Diet Preference: ${client.diet_pref}\n`;
  if (client.schedule) prompt += `Available Schedule: ${client.schedule}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, `;
      prompt += `Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += `\n`;
    }
  }

  if (weekNo > 1) {
    prompt += `\nThis is a progressive program. Adjust intensity and volume based on the check-in data. `;
    prompt += `Focus on progressive overload where compliance is high, and reduce volume where energy is low.`;
  }

  return prompt;
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fillColor('#B8965A')
      .fontSize(28)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fillColor('#FFFFFF')
      .fontSize(14)
      .font('Helvetica')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(3);

    if (programData.workout_plan) {
      doc.fillColor('#B8965A').fontSize(20).font('Helvetica-Bold').text('WORKOUT PLAN');
      doc.moveDown(0.5);

      if (programData.workout_plan.summary) {
        doc.fillColor('#2C2C2C').fontSize(11).font('Helvetica').text(programData.workout_plan.summary);
        doc.moveDown(0.5);
      }

      if (programData.workout_plan.days) {
        for (const day of programData.workout_plan.days) {
          doc.moveDown(0.3);
          doc.fillColor('#2C2C2C').fontSize(13).font('Helvetica-Bold')
            .text(`${day.day} — ${day.focus || ''}`);

          if (day.exercises) {
            for (const ex of day.exercises) {
              doc.fillColor('#444444').fontSize(10).font('Helvetica')
                .text(`  • ${ex.name}: ${ex.sets} sets × ${ex.reps} | Rest: ${ex.rest || '60s'}${ex.notes ? ' — ' + ex.notes : ''}`, { indent: 15 });
            }
          }
        }
      }
    }

    if (doc.y > 650) doc.addPage();
    doc.moveDown(1.5);

    if (programData.nutrition_plan) {
      doc.fillColor('#B8965A').fontSize(20).font('Helvetica-Bold').text('NUTRITION PLAN');
      doc.moveDown(0.5);

      const np = programData.nutrition_plan;
      doc.fillColor('#2C2C2C').fontSize(11).font('Helvetica')
        .text(`Daily Targets: ${np.calories || '—'} kcal | Protein: ${np.protein_g || '—'}g | Carbs: ${np.carbs_g || '—'}g | Fat: ${np.fat_g || '—'}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fillColor('#2C2C2C').fontSize(11).font('Helvetica-Bold').text(meal.meal + ':');
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fillColor('#444444').fontSize(10).font('Helvetica').text(`  • ${opt}`, { indent: 15 });
            }
          }
        }
      }

      if (np.supplements) {
        doc.moveDown(0.5);
        doc.fillColor('#2C2C2C').fontSize(11).font('Helvetica-Bold').text('Supplements:');
        for (const s of np.supplements) {
          doc.fillColor('#444444').fontSize(10).font('Helvetica').text(`  • ${s}`, { indent: 15 });
        }
      }
    }

    if (programData.coach_note) {
      doc.moveDown(1);
      doc.fillColor('#B8965A').fontSize(12).font('Helvetica-Bold').text('Coach\'s Note:');
      doc.fillColor('#2C2C2C').fontSize(11).font('Helvetica-Oblique').text(programData.coach_note);
    }

    doc.moveDown(2);
    doc.fillColor('#C8B89A').fontSize(9).font('Helvetica')
      .text('© Fitness by Maddy | fitnessbymaddy.com | This program is for personal use only.', { align: 'center' });

    doc.end();
  });
}
