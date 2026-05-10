const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: prevPrograms } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildProgramPrompt(client, recentCheckins, prevPrograms, week_no);

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: `You are an expert fitness program architect for FitnessByMaddy.
You create safe, effective, progressive workout and nutrition plans.

CRITICAL SAFETY RULES:
- Never prescribe fewer than 1200 calories for women or 1500 for men
- Never recommend banned or controlled substances
- Never suggest training through pain or injury
- Never promise specific timeline results (e.g., "lose 10kg in 2 weeks")
- Always include rest days (minimum 1 per week)
- Progressive overload must be gradual (max 5-10% increase per week)

Respond with valid JSON only. No markdown, no explanations outside JSON.`,
    });

    const responseText = response.content[0].text;
    let programData;

    try {
      programData = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        programData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Claude response was not valid JSON');
      }
    }

    if (hasSafetyIssues(programData)) {
      await sendWhatsApp(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        ['unsafe_program', maskPhone(client.phone), `Week ${week_no} program flagged for review`]
      );
      return res.status(200).json({ ok: false, reason: 'safety_review_needed' });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = await db.storage
      .from('clients')
      .createSignedUrl(pdfPath, 60 * 60 * 24 * 7);

    const pdfUrl = urlData?.signedUrl || '';

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || programData.workout || {},
      nutrition_plan: programData.nutrition_plan || programData.nutrition || {},
      notes: programData.notes || programData.coach_notes || '',
    });

    if (pdfUrl) {
      await sendWhatsApp(client.phone, 'program_delivery', [
        client.name || 'there',
        String(week_no),
        programData.notes || 'New program ready!',
      ], pdfUrl);

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({ ok: true, week_no, pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildProgramPrompt(client, checkins, prevPrograms, weekNo) {
  let prompt = `Generate a Week ${weekNo} fitness program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
`;

  if (checkins && checkins.length > 0) {
    prompt += '\nRECENT CHECK-INS:\n';
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  if (prevPrograms && prevPrograms.length > 0) {
    prompt += `\nPREVIOUS WEEK (${prevPrograms[0].week_no}) NOTES: ${prevPrograms[0].notes || 'None'}\n`;
  }

  prompt += `
OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "rest_days": ["Sunday"],
    "cardio": "20 min LISS on rest days"
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 160,
    "carbs_g": 240,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "suggestion": "4 egg whites + 1 whole egg + oats", "calories": 400 }
    ],
    "hydration": "3-4 liters water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "One-liner coach note for WhatsApp delivery"
}`;

  return prompt;
}

function hasSafetyIssues(programData) {
  const nutrition = programData.nutrition_plan || programData.nutrition || {};
  const calories = nutrition.daily_calories;

  if (calories && calories < 1200) return true;

  const supplements = nutrition.supplements || [];
  const banned = ['steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra', 'hgh'];
  for (const supp of supplements) {
    const lower = (supp || '').toLowerCase();
    if (banned.some(b => lower.includes(b))) return true;
  }

  const notes = (programData.notes || '').toLowerCase();
  if (notes.includes('guaranteed') || notes.includes('100% result')) return true;

  return false;
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    // Header
    doc.rect(0, 0, 595.28, 100).fill(charcoal);
    doc.fontSize(28).fillColor(gold).text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(14).fillColor('#ffffff')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 65);

    doc.moveDown(3);

    // Workout Plan
    const workout = programData.workout_plan || programData.workout || {};
    doc.fontSize(18).fillColor(gold).text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(gold).stroke();
    doc.moveDown(0.5);

    const days = workout.days || [];
    for (const day of days) {
      doc.fontSize(13).fillColor(charcoal).text(`${day.day} — ${day.focus}`, 50);
      doc.moveDown(0.3);

      for (const ex of day.exercises || []) {
        const line = `  ${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest || '60s'}`;
        doc.fontSize(10).fillColor('#555555').text(line, 60);
      }
      doc.moveDown(0.5);
    }

    if (workout.rest_days) {
      doc.fontSize(10).fillColor('#888888')
        .text(`Rest Days: ${Array.isArray(workout.rest_days) ? workout.rest_days.join(', ') : workout.rest_days}`, 50);
    }
    if (workout.cardio) {
      doc.fontSize(10).fillColor('#888888').text(`Cardio: ${workout.cardio}`, 50);
    }

    doc.addPage();

    // Nutrition Plan
    const nutrition = programData.nutrition_plan || programData.nutrition || {};
    doc.fontSize(18).fillColor(gold).text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(gold).stroke();
    doc.moveDown(0.5);

    if (nutrition.daily_calories) {
      doc.fontSize(12).fillColor(charcoal)
        .text(`Daily Target: ${nutrition.daily_calories} kcal`, 50);
      doc.fontSize(10).fillColor('#555555')
        .text(`Protein: ${nutrition.protein_g || '—'}g  |  Carbs: ${nutrition.carbs_g || '—'}g  |  Fat: ${nutrition.fat_g || '—'}g`, 50);
      doc.moveDown(0.5);
    }

    const meals = nutrition.meals || [];
    for (const meal of meals) {
      doc.fontSize(11).fillColor(charcoal).text(meal.meal, 50);
      doc.fontSize(10).fillColor('#555555').text(`  ${meal.suggestion} (~${meal.calories || '—'} kcal)`, 60);
      doc.moveDown(0.3);
    }

    if (nutrition.hydration) {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#888888').text(`Hydration: ${nutrition.hydration}`, 50);
    }

    if (nutrition.supplements && nutrition.supplements.length > 0) {
      doc.fontSize(10).fillColor('#888888')
        .text(`Supplements: ${nutrition.supplements.join(', ')}`, 50);
    }

    // Coach Note
    if (programData.notes) {
      doc.moveDown(1);
      doc.fontSize(11).fillColor(gold).text('Coach Note:', 50);
      doc.fontSize(10).fillColor(charcoal).text(programData.notes, 50);
    }

    // Footer
    doc.fontSize(8).fillColor('#aaaaaa')
      .text('This program is designed specifically for you. Do not share.', 50, 770, { align: 'center' });

    doc.end();
  });
}
