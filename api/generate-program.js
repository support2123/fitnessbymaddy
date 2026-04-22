const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /anabolic/i,
  /steroid/i,
  /sarm/i,
  /ephedra/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i,
];

function checkSafety(text) {
  for (const pattern of RISKY_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

async function generateWithClaude(client, checkins) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const lastCheckins = checkins.slice(-2);
  const checkinSummary = lastCheckins.map(c =>
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`
  ).join('\n');

  const prompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand.

Client Profile:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Current week data:
${checkinSummary || 'No check-in data yet (Week 1)'}

Generate a complete weekly program in JSON format with two top-level keys:
1. "workout_plan": An object with keys for each training day (e.g., "day1_push", "day2_pull", etc.). Each day contains an array of exercises with: name, sets, reps, rest_seconds, notes.
2. "nutrition_plan": An object with: daily_calories, protein_g, carbs_g, fat_g, meal_timing (array of meals with time and description), hydration_liters, supplements (array).
3. "coach_note": A 1-2 sentence motivational/contextual note for the client.

Rules:
- Be evidence-based. No bro-science.
- Calories must be minimum 1400 for women, 1600 for men.
- Never recommend banned substances, extreme protocols, or unrealistic timelines.
- Adjust based on check-in data: if compliance is low, simplify. If energy is low, reduce volume.
- Progressive overload week over week.

Return ONLY valid JSON, no markdown wrapping.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;

  if (!checkSafety(text)) {
    return { safe: false, raw: text };
  }

  const parsed = JSON.parse(text);
  return { safe: true, data: parsed };
}

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').text(
      `Week ${weekNo} Program | ${client.name || 'Client'}`,
      50, 75
    );

    doc.moveDown(3);

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const workout = programData.workout_plan || {};
    for (const [day, exercises] of Object.entries(workout)) {
      doc.fontSize(13).fill('#B8965A').text(day.replace(/_/g, ' ').toUpperCase(), 50);
      doc.moveDown(0.3);

      if (Array.isArray(exercises)) {
        for (const ex of exercises) {
          doc.fontSize(10).fill('#2C2C2C').text(
            `  ${ex.name} — ${ex.sets}x${ex.reps} | Rest: ${ex.rest_seconds}s${ex.notes ? ' | ' + ex.notes : ''}`,
            60
          );
        }
      }
      doc.moveDown(0.5);
    }

    if (doc.y > 650) doc.addPage();

    doc.moveDown(1);
    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const nutrition = programData.nutrition_plan || {};
    doc.fontSize(11).fill('#2C2C2C');
    doc.text(`Daily Calories: ${nutrition.daily_calories || 'TBD'} kcal`, 60);
    doc.text(`Protein: ${nutrition.protein_g || 'TBD'}g | Carbs: ${nutrition.carbs_g || 'TBD'}g | Fat: ${nutrition.fat_g || 'TBD'}g`, 60);
    doc.text(`Hydration: ${nutrition.hydration_liters || 3}L/day`, 60);
    doc.moveDown(0.5);

    if (Array.isArray(nutrition.meal_timing)) {
      doc.fontSize(12).fill('#B8965A').text('Meal Timing:', 60);
      for (const meal of nutrition.meal_timing) {
        doc.fontSize(10).fill('#2C2C2C').text(`  ${meal.time} — ${meal.description}`, 70);
      }
    }

    if (Array.isArray(nutrition.supplements) && nutrition.supplements.length) {
      doc.moveDown(0.5);
      doc.fontSize(12).fill('#B8965A').text('Supplements:', 60);
      for (const supp of nutrition.supplements) {
        doc.fontSize(10).fill('#2C2C2C').text(`  ${supp}`, 70);
      }
    }

    if (programData.coach_note) {
      doc.moveDown(1);
      doc.fontSize(12).fill('#B8965A').text('Coach Note:', 50);
      doc.fontSize(11).fill('#2C2C2C').text(programData.coach_note, 60);
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#999999').text('Generated by FitnessByMaddy Coaching System', 50, doc.page.height - 40);

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: existing } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(200).json({ message: 'Program already exists', program_id: existing.id });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: true });

    const result = await generateWithClaude(client, checkins || []);

    if (!result.safe) {
      const { escalateToMaddy } = require('./_lib/escalation');
      const { maskPhone } = require('./_lib/whatsapp');
      await escalateToMaddy('Unsafe program content flagged', {
        phone: maskPhone(client.phone),
        message: `Week ${week_no} program generation flagged for safety review`,
      });

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: null,
        nutrition_plan: null,
        notes: 'FLAGGED FOR REVIEW: ' + result.raw.slice(0, 500),
      });

      return res.status(200).json({ flagged: true, reason: 'Safety review needed' });
    }

    const pdfBuffer = await generatePDF(client, week_no, result.data);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `clients/${client_id}/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    let pdfUrl = null;
    if (!uploadErr) {
      const { data: urlData } = supabase.storage
        .from('programs')
        .getPublicUrl(storagePath);
      pdfUrl = urlData?.publicUrl || null;
    }

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: result.data.workout_plan,
        nutrition_plan: result.data.nutrition_plan,
        pdf_url: pdfUrl,
        notes: result.data.coach_note || null,
      })
      .select()
      .single();

    if (pdfUrl) {
      await sendTemplate(client.phone, 'weekly_program', [
        client.name || 'there',
        `Week ${week_no}`,
        pdfUrl,
      ]);

      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
