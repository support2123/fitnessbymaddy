const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./lib/supabase');
const { sendWhatsAppWithPdf } = require('./lib/whatsapp');
const { parseBody, corsHeaders, json } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalation');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /banned\s*substance/i,
  /steroid/i,
  /dnp|clenbuterol|ephedra/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i
];

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return json(res, 400, { error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return json(res, 404, { error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic();
    const prompt = buildPrompt(client, recentCheckins || [], prevPrograms || [], week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    const hasRisk = RISKY_PATTERNS.some(p => p.test(responseText));
    if (hasRisk) {
      await escalateToMaddy('Program generation flagged — risky content', {
        phone: client.phone,
        name: client.name,
        details: `Week ${week_no} program contained potentially unsafe recommendations. Halted auto-send.`
      });
      return json(res, 200, {
        ok: false,
        action: 'flagged_for_review',
        message: 'Program flagged for Maddy review'
      });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch {
      parsed = { workout_plan: { raw: responseText }, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePdf(client, week_no, parsed);

    const filePath = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || '';

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || parsed.workout || {},
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
      notes: parsed.notes || null
    }).select().single();

    await sendWhatsAppWithPdf(
      client.phone,
      pdfUrl,
      `Week ${week_no} program is ready! Check your plan and let's crush it.`
    );

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return json(res, 200, {
      ok: true,
      program_id: program.id,
      pdf_url: pdfUrl
    });

  } catch (err) {
    console.error('Program gen error:', err.message);
    return json(res, 500, { error: 'Program generation failed' });
  }
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues: ${c.issues || 'none'}`
  ).join('\n') || 'No previous check-ins.';

  const prevPlan = prevPrograms.length > 0
    ? `Previous week plan notes: ${prevPrograms[0].notes || 'N/A'}`
    : 'First week — no previous plan.';

  return `You are a certified personal trainer and nutrition coach creating a weekly fitness program.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary}

${prevPlan}

INSTRUCTIONS:
1. Create a 7-day workout plan appropriate for week ${weekNo}
2. Create a daily nutrition plan with macros
3. Apply progressive overload from previous weeks
4. Adjust based on compliance, energy, and reported issues
5. Be specific with exercises, sets, reps, rest periods
6. Include warm-up and cool-down
7. NEVER recommend extreme calorie deficits (below 1200cal), banned substances, or unrealistic timelines

Return a JSON object with this structure:
\`\`\`json
{
  "workout_plan": {
    "overview": "Brief week overview",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "warmup": "5 min...",
        "exercises": [
          {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
        ],
        "cooldown": "5 min stretching"
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      {"meal": "Breakfast", "suggestion": "...", "calories": 500}
    ],
    "notes": "Hydration and supplement guidance"
  },
  "notes": "Coach notes for this week"
}
\`\`\``;
}

function generatePdf(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#FFFFFF').fontSize(14).text(`Week ${weekNo} Program`, 50, 70, { align: 'center' });
    doc.fill('#D4AF7A').fontSize(10).text(`${client.name || 'Client'} | ${client.program}`, 50, 90, { align: 'center' });

    doc.moveDown(3);

    const workout = plan.workout_plan || {};
    if (workout.overview) {
      doc.fill('#2C2C2C').fontSize(12).text(workout.overview, 50);
      doc.moveDown();
    }

    if (workout.days) {
      workout.days.forEach(day => {
        if (doc.y > 700) doc.addPage();

        doc.rect(50, doc.y, doc.page.width - 100, 28).fill('#2C2C2C');
        doc.fill('#B8965A').fontSize(12).text(
          `${day.day} — ${day.focus}`,
          60, doc.y - 22
        );
        doc.moveDown(0.5);
        doc.fill('#2C2C2C');

        if (day.warmup) {
          doc.fontSize(9).fill('#6B6B6B').text(`Warm-up: ${day.warmup}`, 60);
        }

        if (day.exercises) {
          day.exercises.forEach(ex => {
            const line = `${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`;
            doc.fontSize(10).fill('#2C2C2C').text(line, 60);
          });
        }

        if (day.cooldown) {
          doc.fontSize(9).fill('#6B6B6B').text(`Cool-down: ${day.cooldown}`, 60);
        }

        doc.moveDown(0.8);
      });
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(18).text('NUTRITION PLAN', 50, 20, { align: 'center' });
    doc.moveDown(2);

    const nutrition = plan.nutrition_plan || {};
    if (nutrition.daily_calories) {
      doc.fill('#2C2C2C').fontSize(11);
      doc.text(`Daily Calories: ${nutrition.daily_calories} kcal`, 50);
      doc.text(`Protein: ${nutrition.protein_g || '—'}g | Carbs: ${nutrition.carbs_g || '—'}g | Fat: ${nutrition.fat_g || '—'}g`, 50);
      doc.moveDown();
    }

    if (nutrition.meals) {
      nutrition.meals.forEach(meal => {
        doc.fontSize(11).fill('#B8965A').text(meal.meal, 50);
        doc.fontSize(10).fill('#2C2C2C').text(`${meal.suggestion} (${meal.calories || '—'} kcal)`, 60);
        doc.moveDown(0.3);
      });
    }

    if (nutrition.notes) {
      doc.moveDown();
      doc.fontSize(10).fill('#6B6B6B').text(nutrition.notes, 50);
    }

    if (plan.notes) {
      doc.moveDown(2);
      doc.fontSize(11).fill('#2C2C2C').text("Coach's Notes:", 50);
      doc.fontSize(10).fill('#6B6B6B').text(plan.notes, 50);
    }

    doc.moveDown(3);
    doc.fontSize(8).fill('#B8965A').text('www.fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}
