const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplateForced } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet',
  'water fasting for', 'ephedrine', 'sarm'
];

function checkProgramSafety(text) {
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

async function generateWithClaude(client, checkins, weekNo) {
  const anthropic = new Anthropic();

  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a real client. Be precise, safe, and evidence-based.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

RECENT CHECK-INS:
${checkinSummary || 'No check-in data yet (Week 1)'}

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines
- Adapt based on compliance score and energy levels
- If energy is low (<=4), reduce volume and add deload suggestions
- If compliance is low (<=4), simplify the plan

Generate a JSON response with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...for each training day
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "notes": "Overall training notes for the week"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 65,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "3 eggs + oats + banana", "calories": 450 }
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": "Nutrition notes"
  },
  "weekly_focus": "One sentence focus for the week",
  "coach_note": "Encouraging personal note to the client"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');

  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(programData, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fillColor('#B8965A')
      .fontSize(12)
      .text('FITNESS BY MADDY', 50, 50, { characterSpacing: 4 });

    doc.fillColor('#ffffff')
      .fontSize(32)
      .text(`WEEK ${weekNo}`, 50, 90);

    doc.fillColor('#B8965A')
      .fontSize(14)
      .text(`Program for ${client.name || 'Client'}`, 50, 130);

    doc.moveTo(50, 160).lineTo(545, 160).strokeColor('#B8965A').lineWidth(1).stroke();

    let y = 180;

    if (programData.weekly_focus) {
      doc.fillColor('#D4AF7A').fontSize(11).text('WEEKLY FOCUS', 50, y);
      y += 18;
      doc.fillColor('#ffffff').fontSize(10).text(programData.weekly_focus, 50, y, { width: 495 });
      y += 30;
    }

    doc.fillColor('#B8965A').fontSize(16).text('WORKOUT PLAN', 50, y);
    y += 25;

    if (programData.workout_plan && programData.workout_plan.days) {
      for (const day of programData.workout_plan.days) {
        if (y > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }

        doc.fillColor('#D4AF7A').fontSize(12).text(`${day.day} — ${day.focus}`, 50, y);
        y += 18;

        for (const ex of day.exercises || []) {
          if (y > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
          doc.fillColor('#ffffff').fontSize(9)
            .text(`  ${ex.name}`, 50, y, { continued: true })
            .fillColor('#999999')
            .text(`  ${ex.sets}x${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`);
          y += 15;
        }
        y += 10;
      }
    }

    y += 10;
    if (y > 650) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }

    doc.fillColor('#B8965A').fontSize(16).text('NUTRITION PLAN', 50, y);
    y += 25;

    if (programData.nutrition_plan) {
      const np = programData.nutrition_plan;
      doc.fillColor('#ffffff').fontSize(10);
      doc.text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 50, y);
      y += 20;

      if (np.meal_framework) {
        for (const meal of np.meal_framework) {
          if (y > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
          doc.fillColor('#D4AF7A').fontSize(9).text(meal.meal, 50, y, { continued: true });
          doc.fillColor('#ffffff').text(`  ${meal.suggestion} (~${meal.calories} cal)`);
          y += 15;
        }
      }
      y += 10;
      if (np.hydration) {
        doc.fillColor('#999999').fontSize(9).text(`Hydration: ${np.hydration}`, 50, y);
        y += 15;
      }
    }

    if (programData.coach_note) {
      if (y > 680) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
      y += 10;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#B8965A').lineWidth(0.5).stroke();
      y += 15;
      doc.fillColor('#D4AF7A').fontSize(10).text('NOTE FROM MADDY', 50, y);
      y += 16;
      doc.fillColor('#ffffff').fontSize(10).text(programData.coach_note, 50, y, { width: 495 });
    }

    doc.end();
  });
}

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

    const programData = await generateWithClaude(client, recentCheckins || [], week_no);

    const fullText = JSON.stringify(programData);
    const safetyFlag = checkProgramSafety(fullText);
    if (safetyFlag) {
      const { notifyMaddy } = require('../lib/whatsapp');
      await db.from('escalations').insert({
        phone: client.phone,
        reason: 'unsafe_program_content',
        message_body: `Week ${week_no} program flagged: "${safetyFlag}"`
      });
      await notifyMaddy('unsafe_program_content',
        `Client ${client.name || maskPhone(client.phone)} week ${week_no}: flagged "${safetyFlag}". Review before sending.`);
      return res.status(200).json({ ok: false, reason: 'flagged_for_review', flag: safetyFlag });
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note
    });

    if (insertErr) throw insertErr;

    const contextNote = programData.weekly_focus || `Week ${week_no} program ready`;
    await sendTemplateForced(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      contextNote
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
