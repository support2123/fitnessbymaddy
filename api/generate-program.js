const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const supabase = require('../lib/supabase');
const { sendMediaMessage, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/helpers');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

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

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const prompt = buildPrompt(client, recentCheckins || [], week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      await notifyMaddy(
        'Program generation parse error',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nClaude output could not be parsed.`
      );
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    if (hasSafetyIssues(parsed)) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nReason: Potential safety concern in generated program.`
      );
      return res.status(200).json({ ok: true, status: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const filePath = `${client.phone}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData.publicUrl;

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes || null
    });

    if (insertError) throw insertError;

    const caption = `Week ${week_no} program for ${client.name || 'you'} is ready! 💪`;
    await sendMediaMessage(client.phone, pdfUrl, caption);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a NASM-certified fitness program architect for FitnessByMaddy. Generate a week ${weekNo} program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Not specified'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10` : ''}

RULES:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Never promise specific weight loss timelines
- Adjust intensity based on compliance and energy scores
- If compliance < 5, simplify the program
- If energy < 4, reduce volume and add recovery work

Return a JSON object with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coaching note for the client"
}`;
}

function hasSafetyIssues(program) {
  if (!program?.nutrition_plan) return false;
  const cals = program.nutrition_plan.calories;
  if (cals && cals < 1200) return true;
  const supps = program.nutrition_plan.supplements || [];
  const banned = ['steroid', 'ephedra', 'dnp', 'clenbuterol', 'sarm'];
  return supps.some(s => banned.some(b => s.toLowerCase().includes(b)));
}

function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#C8B89A').text(client.name || 'Client', 50, 95, { align: 'center' });

    doc.moveDown(3);
    let y = 150;

    // Workout Plan
    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50, y);
    y += 30;

    doc.rect(50, y - 5, doc.page.width - 100, 2).fill('#B8965A');
    y += 10;

    if (program.workout_plan?.days) {
      for (const day of program.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).fill('#B8965A').text(day.day.toUpperCase(), 50, y);
        doc.fontSize(10).fill('#6B6B6B').text(day.focus || '', 150, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#2C2C2C')
              .text(`• ${ex.name}`, 70, y)
              .text(`${ex.sets}×${ex.reps}`, 350, y)
              .text(ex.rest || '', 420, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    if (y > 550) { doc.addPage(); y = 50; }

    // Nutrition Plan
    y += 20;
    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50, y);
    y += 30;
    doc.rect(50, y - 5, doc.page.width - 100, 2).fill('#B8965A');
    y += 10;

    if (program.nutrition_plan) {
      const np = program.nutrition_plan;
      doc.fontSize(11).fill('#2C2C2C');
      doc.text(`Daily Target: ${np.calories || '—'} kcal`, 50, y);
      y += 18;
      doc.fontSize(10).fill('#6B6B6B');
      doc.text(`Protein: ${np.protein_g || '—'}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fat: ${np.fat_g || '—'}g`, 50, y);
      y += 25;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill('#B8965A').text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill('#6B6B6B').text(`  → ${opt}`, 70, y);
              y += 14;
            }
          }
          y += 6;
        }
      }
    }

    // Coaching Notes
    if (program.notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      y += 20;
      doc.fontSize(14).fill('#2C2C2C').text('COACH\'S NOTES', 50, y);
      y += 25;
      doc.rect(50, y - 5, doc.page.width - 100, 2).fill('#B8965A');
      y += 10;
      doc.fontSize(10).fill('#6B6B6B').text(program.notes, 50, y, { width: doc.page.width - 100 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#C8B89A')
        .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 40, { align: 'center' });
    }

    doc.end();
  });
}
