const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendWhatsAppForced } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*calorie/i, /extreme\s*cut/i,
  /clenbuterol/i, /dnp/i, /steroid/i, /sarm/i, /ephedra/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*in\s*(1|one)\s*week/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect working for FitnessByMaddy, an elite online coaching brand. You create personalized weekly workout and nutrition plans.

Rules:
- Never prescribe fewer than 1200 calories/day for women or 1500 for men
- Never recommend banned substances, SARMs, or steroids
- Never promise specific weight loss timelines
- Always include warm-up and cool-down
- Progressive overload principle must be applied
- If client reports pain or injury, recommend rest and medical consultation
- Output must be valid JSON`;

    const userPrompt = buildPrompt(client, lead, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let programData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Invalid program output' });
    }

    const safetyCheck = checkSafety(JSON.stringify(programData));
    if (!safetyCheck.safe) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: `unsafe_program: ${safetyCheck.flag}`,
        phone: client.phone,
        clientName: client.name,
        message: `Week ${week_no} program flagged for review`
      });
      return res.json({ ok: false, reason: 'flagged_for_review', flag: safetyCheck.flag });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const filePath = `${client.folder_url || 'clients/' + client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = supabase.storage.from('clients').getPublicUrl(filePath);

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: programData.workout_plan || programData.workout || {},
      nutrition_plan: programData.nutrition_plan || programData.nutrition || {},
      notes: programData.notes || null
    });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
    }

    const market = lead ? lead.market : 'GLOBAL';
    const msg = isHinglish(market)
      ? `Week ${week_no} ka program ready hai! 📋 Yeh raha aapka personalized plan. Koi doubt ho toh message karo.`
      : `Your Week ${week_no} program is ready! 📋 Here's your personalized plan. Message us if you have any questions.`;

    await sendWhatsAppForced({
      phone: client.phone,
      templateName: 'weekly_program',
      body: msg,
      params: [String(week_no), client.name || 'there']
    });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ ok: true, client_id, week_no, pdf_url: publicUrl?.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, lead, checkins, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'none'}`
  ).join('\n');

  return `Create a Week ${weekNo} program for this client:

Name: ${client.name || 'Client'}
Program: ${client.program}
Started: ${client.program_started_at}

${checkinSummary ? `Recent check-ins:\n${checkinSummary}` : 'No previous check-ins yet.'}

Output a JSON object with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ], "warmup": "...", "cooldown": "..." }
    ],
    "rest_days": ["Sunday"],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "notes": "..."
  },
  "notes": "Key focus for this week..."
}`;
}

function checkSafety(text) {
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, flag: pattern.source };
    }
  }
  return { safe: true };
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');
    doc.fill('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#ffffff').fontSize(14).text(`Week ${weekNo} Program`, 50, 72, { align: 'center' });
    doc.fill('#999999').fontSize(10).text(client.name || 'Client', 50, 95, { align: 'center' });

    doc.moveDown(3);

    const workout = programData.workout_plan || programData.workout || {};
    if (workout.days) {
      doc.fill('#1a1a1a').fontSize(18).text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      doc.rect(50, doc.y, 100, 2).fill('#B8965A');
      doc.moveDown(0.8);

      for (const day of workout.days) {
        if (doc.y > 700) { doc.addPage(); }
        doc.fill('#1a1a1a').fontSize(13).text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc.fill('#666666').fontSize(9).text(`Warm-up: ${day.warmup}`, 60);
        }

        for (const ex of (day.exercises || [])) {
          doc.fill('#333333').fontSize(10)
            .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60);
        }

        if (day.cooldown) {
          doc.fill('#666666').fontSize(9).text(`Cool-down: ${day.cooldown}`, 60);
        }
        doc.moveDown(0.5);
      }
    }

    const nutrition = programData.nutrition_plan || programData.nutrition || {};
    if (nutrition.calories) {
      if (doc.y > 550) { doc.addPage(); }
      doc.moveDown(1);
      doc.fill('#1a1a1a').fontSize(18).text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);
      doc.rect(50, doc.y, 100, 2).fill('#B8965A');
      doc.moveDown(0.8);

      doc.fill('#333333').fontSize(11)
        .text(`Calories: ${nutrition.calories} kcal  |  Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fat: ${nutrition.fat_g}g`, 50);
      doc.moveDown(0.5);

      for (const meal of (nutrition.meals || [])) {
        doc.fill('#1a1a1a').fontSize(10).text(meal.meal, 60);
        for (const opt of (meal.options || [])) {
          doc.fill('#666666').fontSize(9).text(`  • ${opt}`, 70);
        }
        doc.moveDown(0.3);
      }
    }

    if (programData.notes) {
      if (doc.y > 650) { doc.addPage(); }
      doc.moveDown(1);
      doc.fill('#1a1a1a').fontSize(12).text('NOTES', 50);
      doc.fill('#666666').fontSize(10).text(programData.notes, 50, undefined, { width: 495 });
    }

    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill('#1a1a1a');
    doc.fill('#B8965A').fontSize(8).text('fitnessbymaddy.com', 50, doc.page.height - 28, { align: 'center' });

    doc.end();
  });
}
