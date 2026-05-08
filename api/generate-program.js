const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const RISKY_TERMS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    const { data: previousProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, recentCheckins, previousProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    const lower = content.toLowerCase();
    const risky = RISKY_TERMS.find(t => lower.includes(t));
    if (risky) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        reason: `Risky program content: "${risky}"`,
        message_body: `Week ${week_no} program for client ${client_id} flagged for review`
      });
      return res.json({ ok: false, reason: 'flagged_for_review', term: risky });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: parsed.workout_plan || parsed,
      nutrition_plan: parsed.nutrition_plan || {},
      notes: parsed.coach_notes || null
    }).select().single();

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [
        client.name || 'there',
        `Week ${week_no}`,
        publicUrl?.publicUrl || 'Check your client portal'
      ]
    });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || 'none'}`
  ).join('\n');

  return `You are an expert fitness program architect for FitnessByMaddy.
Generate a Week ${weekNo} program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

${prevProgram ? `PREVIOUS WEEK PLAN NOTES: ${prevProgram.notes || 'None'}` : ''}

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- Progressive overload principles
- Consider reported energy levels and compliance
- If issues mention pain, suggest modification not removal

Return a JSON object with this exact structure:
\`\`\`json
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
    "cardio": { "frequency": "3x/week", "type": "LISS", "duration": "30min" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meal_timing": ["Meal 1: 8am", "Meal 2: 12pm", "Meal 3: 4pm", "Meal 4: 8pm"],
    "notes": "Focus on protein with each meal"
  },
  "coach_notes": "Brief note about this week's focus and adjustments"
}
\`\`\``;
}

function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, 595, 80).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(24).text('FITNESS BY MADDY', 50, 25, { width: 495 });
    doc.fill('#FFFFFF').fontSize(12).text(`Week ${weekNo} Program`, 50, 52, { width: 495 });

    doc.moveDown(3);
    doc.fill('#2C2C2C').fontSize(18).text(`${client.name || 'Client'} — Week ${weekNo}`);
    doc.moveDown(0.5);
    doc.fill('#6B6B6B').fontSize(10).text(`Program: ${(client.program || '').replace(/_/g, ' ').toUpperCase()}`);
    doc.moveDown(1.5);

    if (plan.workout_plan?.days) {
      doc.fill('#B8965A').fontSize(14).text('WORKOUT PLAN');
      doc.moveDown(0.5);

      for (const day of plan.workout_plan.days) {
        doc.fill('#2C2C2C').fontSize(11).text(`${day.day} — ${day.focus}`);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#6B6B6B').fontSize(9)
              .text(`  ${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`);
          }
        }
        doc.moveDown(0.5);
      }

      if (plan.workout_plan.cardio) {
        doc.moveDown(0.3);
        const c = plan.workout_plan.cardio;
        doc.fill('#2C2C2C').fontSize(10).text(`Cardio: ${c.frequency} ${c.type} — ${c.duration}`);
      }
    }

    doc.moveDown(1.5);

    if (plan.nutrition_plan) {
      doc.fill('#B8965A').fontSize(14).text('NUTRITION PLAN');
      doc.moveDown(0.5);
      const n = plan.nutrition_plan;
      if (n.calories) doc.fill('#2C2C2C').fontSize(10).text(`Daily Calories: ${n.calories} kcal`);
      if (n.protein_g) doc.fill('#6B6B6B').fontSize(9).text(`Protein: ${n.protein_g}g | Carbs: ${n.carbs_g}g | Fat: ${n.fat_g}g`);
      if (n.meal_timing) {
        doc.moveDown(0.3);
        for (const meal of n.meal_timing) {
          doc.fill('#6B6B6B').fontSize(9).text(`  ${meal}`);
        }
      }
      if (n.notes) {
        doc.moveDown(0.3);
        doc.fill('#2C2C2C').fontSize(9).text(n.notes);
      }
    }

    if (plan.coach_notes) {
      doc.moveDown(1.5);
      doc.fill('#B8965A').fontSize(14).text("COACH'S NOTES");
      doc.moveDown(0.3);
      doc.fill('#2C2C2C').fontSize(10).text(plan.coach_notes);
    }

    const bottomY = doc.page.height - 40;
    doc.fill('#C8B89A').fontSize(8).text(
      'fitnessbymaddy.com | This program is personalised — do not redistribute.',
      50, bottomY, { width: 495, align: 'center' }
    );

    doc.end();
  });
}
