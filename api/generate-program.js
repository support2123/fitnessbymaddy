const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { isHinglish, maskPhone } = require('./_lib/market');
const { escalateToMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedrine', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'crash diet',
];

module.exports = async function handler(req, res) {
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

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create weekly workout and nutrition plans for real clients.
Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan".

workout_plan structure:
{
  "week_focus": "string",
  "days": [
    {
      "day": "Monday",
      "type": "Upper Body Strength",
      "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ],
      "cardio": "20 min LISS post-workout"
    }
  ]
}

nutrition_plan structure:
{
  "daily_calories": 2200,
  "protein_g": 180,
  "carbs_g": 220,
  "fat_g": 65,
  "meals": [
    { "meal": "Breakfast", "options": ["Option A description", "Option B description"] }
  ],
  "hydration": "3-4L water daily",
  "supplements": ["Whey protein", "Creatine 5g"]
}

Rules:
- Never go below 1200 cal for women or 1500 cal for men
- Never recommend banned substances
- Progressive overload week-to-week
- Adjust based on check-in data (compliance, energy, weight trend)
- Be specific with exercise names, sets, reps
- Account for injuries or limitations mentioned in profile`;

    const checkinContext = recentCheckins && recentCheckins.length > 0
      ? recentCheckins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')
      : 'No prior check-in data available (Week 1).';

    const clientProfile = `Client: ${client.name || 'Anonymous'}
Program: ${client.program}
Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}

Recent check-ins:
${checkinContext}

${lead?.intake_data ? `Profile data: ${JSON.stringify(lead.intake_data)}` : 'No detailed profile available.'}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Generate the Week ${week_no} program for this client:\n\n${clientProfile}`,
        },
      ],
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy({
        reason: 'Program generation returned non-JSON',
        phone: client.phone,
        context: `Week ${week_no} — raw output could not be parsed`,
      });
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programData = JSON.parse(jsonMatch[0]);
    const fullText = JSON.stringify(programData).toLowerCase();

    const flagged = SAFETY_FLAGS.some(f => fullText.includes(f));
    if (flagged) {
      await escalateToMaddy({
        reason: 'Program flagged for safety review',
        phone: client.phone,
        context: `Week ${week_no} — content flagged, halted auto-send`,
      });

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'FLAGGED: Awaiting Maddy review',
      });

      return res.status(200).json({ ok: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: `Auto-generated for Week ${week_no}`,
    });

    const hinglish = isHinglish(client.market || 'GLOBAL');
    const contextNote = hinglish
      ? `Week ${week_no} ka plan ready hai! Download karo aur shuru ho jao.`
      : `Your Week ${week_no} plan is ready! Download and get started.`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [contextNote],
      mediaUrl: pdfUrl,
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generatePDF(programData, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 50, right: 50 },
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const CHARCOAL = '#2C2C2C';
    const GOLD = '#B8965A';
    const MID_GREY = '#6B6B6B';

    doc.rect(0, 0, doc.page.width, 120).fill(CHARCOAL);
    doc.fontSize(28).fillColor(GOLD).text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(12).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75);
    doc.fontSize(9).fillColor('#999999')
      .text(`Generated ${new Date().toLocaleDateString('en-IN')}`, 50, 95);

    doc.moveDown(4);

    doc.fontSize(18).fillColor(GOLD).text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (programData.workout_plan) {
      const wp = programData.workout_plan;
      if (wp.week_focus) {
        doc.fontSize(11).fillColor(MID_GREY).text(`Focus: ${wp.week_focus}`);
        doc.moveDown(0.5);
      }

      if (wp.days) {
        for (const day of wp.days) {
          if (doc.y > 680) doc.addPage();

          doc.fontSize(13).fillColor(CHARCOAL).text(`${day.day} — ${day.type || ''}`);
          doc.moveDown(0.3);

          if (day.exercises) {
            for (const ex of day.exercises) {
              doc.fontSize(10).fillColor(MID_GREY)
                .text(`  → ${ex.name}: ${ex.sets}×${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`, { indent: 10 });
            }
          }

          if (day.cardio) {
            doc.fontSize(10).fillColor(GOLD).text(`  Cardio: ${day.cardio}`, { indent: 10 });
          }
          doc.moveDown(0.5);
        }
      }
    }

    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(18).fillColor(GOLD).text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    if (programData.nutrition_plan) {
      const np = programData.nutrition_plan;

      doc.fontSize(11).fillColor(CHARCOAL)
        .text(`Daily Target: ${np.daily_calories || '—'} cal | P: ${np.protein_g || '—'}g | C: ${np.carbs_g || '—'}g | F: ${np.fat_g || '—'}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(12).fillColor(CHARCOAL).text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fillColor(MID_GREY).text(`  → ${opt}`, { indent: 10 });
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor(MID_GREY).text(`Hydration: ${np.hydration}`);
      }

      if (np.supplements && np.supplements.length > 0) {
        doc.fontSize(10).fillColor(MID_GREY).text(`Supplements: ${np.supplements.join(', ')}`);
      }
    }

    doc.moveDown(2);
    const bottomY = Math.max(doc.y, 720);
    doc.fontSize(8).fillColor('#AAAAAA')
      .text('FitnessByMaddy — fitnessbymaddy.com — This plan is personalised and confidential.', 50, bottomY, { align: 'center' });

    doc.end();
  });
}
