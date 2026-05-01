const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const supabase = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/phone');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i, /500\s*cal/i, /starvation/i,
  /clenbuterol/i, /dnp/i, /steroids?/i, /sarms?/i, /ephedra/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i,
  /extreme\s*(cut|deficit|fast)/i
];

function isSafe(text) {
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

function buildPrompt(client, checkins) {
  const latest = checkins[0] || {};
  const previous = checkins[1] || {};

  return `You are a certified fitness program architect for FitnessByMaddy.
Design a one-week training and nutrition plan for this client.

CLIENT PROFILE:
- Program: ${client.program}
- Week: This is for their next training week
- Status: ${client.status}

LATEST CHECK-IN (Week ${latest.week_no || 'N/A'}):
- Weight: ${latest.weight || 'N/A'}
- Waist: ${latest.waist || 'N/A'}
- Compliance: ${latest.compliance_score || 'N/A'}/10
- Energy: ${latest.energy || 'N/A'}/10
- Issues: ${latest.issues || 'None reported'}

PREVIOUS CHECK-IN (Week ${previous.week_no || 'N/A'}):
- Weight: ${previous.weight || 'N/A'}
- Waist: ${previous.waist || 'N/A'}
- Compliance: ${previous.compliance_score || 'N/A'}/10

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, steroids, SARMs, or fat burners
- Never promise specific weight loss timelines
- Adjust intensity based on compliance and energy scores
- If compliance < 5, simplify the plan and add motivation notes
- If issues mention pain/injury, reduce intensity for affected area

OUTPUT FORMAT (JSON only):
{
  "workout_plan": {
    "days": [
      {"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""}]},
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio_recommendation": "..."
  },
  "nutrition_plan": {
    "daily_calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meals": [
      {"meal": "Breakfast", "options": ["...", "..."]},
      ...
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "coach_notes": "One paragraph of encouragement and focus for the week."
}`;
}

function generatePDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill('#1a1a1a');
    doc.fontSize(28).fill('#D4AF7A').text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill('#888888').text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });
    doc.fontSize(10).fill('#888888').text(client.name || 'Client', 400, 55, { align: 'right', width: 145 });

    let y = 110;

    // Workout section
    doc.rect(50, y, 495, 30).fill('#2C2C2C');
    doc.fontSize(12).fill('#D4AF7A').text('WORKOUT PLAN', 60, y + 8, { characterSpacing: 2 });
    y += 45;

    if (workout?.days) {
      for (const day of workout.days) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fontSize(11).fill('#1a1a1a').text(`${day.day} — ${day.focus}`, 50, y);
        y += 18;
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(9).fill('#555555')
              .text(`  ${ex.name}`, 60, y)
              .text(`${ex.sets}x${ex.reps}  Rest: ${ex.rest}`, 350, y, { width: 195, align: 'right' });
            y += 15;
            if (ex.notes) {
              doc.fontSize(8).fill('#888888').text(`    ${ex.notes}`, 70, y);
              y += 12;
            }
          }
        }
        y += 10;
      }
    }

    if (workout?.cardio_recommendation) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fontSize(9).fill('#888888').text(`Cardio: ${workout.cardio_recommendation}`, 60, y);
      y += 25;
    }

    // Nutrition section
    if (y > 650) { doc.addPage(); y = 50; }
    doc.rect(50, y, 495, 30).fill('#2C2C2C');
    doc.fontSize(12).fill('#D4AF7A').text('NUTRITION PLAN', 60, y + 8, { characterSpacing: 2 });
    y += 45;

    if (nutrition) {
      doc.fontSize(10).fill('#1a1a1a')
        .text(`Daily Target: ${nutrition.daily_calories} cal | P: ${nutrition.protein_g}g | C: ${nutrition.carbs_g}g | F: ${nutrition.fats_g}g`, 60, y);
      y += 25;

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill('#2C2C2C').text(meal.meal, 60, y);
          y += 15;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill('#555555').text(`  • ${opt}`, 70, y);
              y += 13;
            }
          }
          y += 5;
        }
      }

      if (nutrition.hydration) {
        if (y > 730) { doc.addPage(); y = 50; }
        doc.fontSize(9).fill('#888888').text(`Hydration: ${nutrition.hydration}`, 60, y);
        y += 20;
      }
    }

    // Coach notes
    if (notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      doc.rect(50, y, 495, 2).fill('#D4AF7A');
      y += 15;
      doc.fontSize(10).fill('#2C2C2C').text(notes, 60, y, { width: 475, lineGap: 4 });
    }

    // Footer
    const lastPage = doc.bufferedPageRange();
    doc.fontSize(8).fill('#AAAAAA')
      .text('fitnessbymaddy.com | Confidential — prepared exclusively for you', 50, 770, { align: 'center', width: 495 });

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

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const prompt = buildPrompt(client, checkins || []);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content[0]?.text || '';

    if (!isSafe(responseText)) {
      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: null,
        nutrition_plan: null,
        notes: responseText,
        flagged: true,
        flag_reason: 'Unsafe content detected — awaiting manual review'
      });

      const { sendTemplate: sendEsc } = require('../lib/whatsapp');
      await sendEsc('917082478374', 'escalation_alert', [
        'Unsafe program content',
        maskPhone(client.phone),
        `Week ${week_no} program flagged for review`
      ]);

      return res.status(200).json({ ok: false, flagged: true });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      return res.status(500).json({ error: 'Failed to parse Claude response' });
    }

    const pdfBuffer = await generatePDF(
      client, week_no,
      parsed.workout_plan,
      parsed.nutrition_plan,
      parsed.coach_notes
    );

    const pdfPath = `${client.folder_url || `clients/${client_id}`}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    let pdfUrl = null;
    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from('client-files')
        .getPublicUrl(pdfPath);
      pdfUrl = urlData.publicUrl;
    }

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_notes,
      flagged: false
    }).select().single();

    if (pdfUrl) {
      await sendTemplate(client.phone, 'weekly_program', [
        client.name || 'there',
        String(week_no)
      ], pdfUrl);

      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    console.log(`Program generated: client=${maskPhone(client.phone)} week=${week_no}`);
    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
