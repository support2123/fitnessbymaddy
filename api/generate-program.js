const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10 kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
    const supabase = getSupabase();

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

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, recentCheckins || [], lastProgram, week_no);

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const flagged = checkSafetyFlags(JSON.stringify(parsed));
    if (flagged) {
      const { createEscalation } = require('./_lib/escalation');
      await createEscalation(client.phone, `Program safety flag: ${flagged}`, JSON.stringify(parsed).slice(0, 500));

      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan || parsed.workout,
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition,
        notes: `FLAGGED: ${flagged}`,
        flagged_for_review: true,
      });

      return res.status(200).json({ success: true, flagged: true, reason: flagged });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || parsed.workout,
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition,
      notes: parsed.notes || null,
      pdf_url: pdfUrl,
    });

    await sendWhatsApp({
      phone: client.phone,
      body: `Hey ${client.name || 'there'}! Your Week ${week_no} program is ready \u{1F525}\n\n${parsed.notes || 'New week, new gains. Check your plan and let\'s go!'}\n\n${pdfUrl}`,
      params: { name: client.name || 'there' },
    });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    console.log(`Program generated: ${maskPhone(client.phone)} week=${week_no}`);
    return res.status(200).json({ success: true, pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, checkins, lastProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: 12-Week Flagship (week ${weekNo} of 12)
- Goal: ${client.goal || 'general fitness'}
- Age: ${client.age || 'unknown'}
- Injuries/conditions: ${client.injuries || 'none reported'}
- Diet preference: ${client.diet_pref || 'no restrictions'}
- Schedule: ${client.schedule || 'flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (first week)'}

${lastProgram ? `LAST WEEK'S FOCUS: ${lastProgram.notes || 'standard progression'}` : ''}

INSTRUCTIONS:
1. Create a complete workout plan for the week (5-6 training days)
2. Create a nutrition plan with macros and meal suggestions
3. Adjust based on check-in data (compliance, energy, issues)
4. Be progressive but safe — never prescribe extreme calorie deficits or banned substances
5. Include a brief coaching note

Return ONLY a JSON object with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "notes": "..." }] }
    ]
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [{ "meal": "Breakfast", "suggestion": "..." }]
  },
  "notes": "Brief coaching note for the week"
}`;
}

function checkSafetyFlags(content) {
  const lower = content.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 70);
    doc.fill('#B8965A').fontSize(11)
      .text(`${client.name || 'Client'} | 12-Week Flagship`, 50, 90);

    doc.moveDown(4);

    const workout = program.workout_plan || program.workout;
    if (workout && workout.days) {
      doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);

      for (const day of workout.days) {
        doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
              .text(`  \u2022 ${ex.name}: ${ex.sets} x ${ex.reps}${ex.notes ? ` (${ex.notes})` : ''}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    }

    const nutrition = program.nutrition_plan || program.nutrition;
    if (nutrition) {
      if (doc.y > 600) doc.addPage();

      doc.moveDown(1);
      doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);

      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold')
        .text(`Calories: ${nutrition.calories} | Protein: ${nutrition.protein_g}g | Carbs: ${nutrition.carbs_g}g | Fats: ${nutrition.fats_g}g`, 50);
      doc.moveDown(0.5);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
            .text(`  \u2022 ${meal.meal}: ${meal.suggestion}`, 60);
        }
      }
    }

    if (program.notes) {
      doc.moveDown(1.5);
      doc.fill('#2C2C2C').fontSize(14).font('Helvetica-Bold')
        .text('COACH\'S NOTE', 50);
      doc.moveDown(0.3);
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
        .text(program.notes, 50, undefined, { width: 500 });
    }

    doc.moveDown(2);
    doc.fill('#B8965A').fontSize(8)
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}
