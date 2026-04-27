const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/phone');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'ephedra', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'crash diet', 'water fast'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a world-class fitness program architect for FitnessByMaddy, an elite online coaching brand. You create safe, science-backed, personalised weekly workout and nutrition plans.

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 kcal for men)
- Never recommend banned substances, steroids, or dangerous supplements
- Never promise unrealistic timelines (e.g., "lose 10kg in 1 week")
- Progressive overload principles
- Adjust based on compliance scores and reported issues
- If client reports pain or injury, reduce intensity for affected areas and flag for coach review

OUTPUT FORMAT: Return valid JSON only, no markdown, no explanation. Structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_focus": "...",
  "coach_notes": "..."
}`;

    const userPrompt = buildUserPrompt(client, recentCheckins || [], prevProgram, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = message.content[0].text;

    const isSafe = !SAFETY_FLAGS.some(flag => responseText.toLowerCase().includes(flag));
    if (!isSafe) {
      await notifyMaddy(
        'Program generation safety flag',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nProgram flagged for review — contains potentially risky recommendations.`
      );
      return res.status(200).json({ success: false, reason: 'safety_flag', needs_review: true });
    }

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

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      throw new Error(`PDF upload failed: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData.publicUrl;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || null
    });

    const contextNote = programData.weekly_focus || `Week ${week_no} program ready`;
    await sendTemplate(client.phone, 'weekly_program', [contextNote], pdfUrl);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, checkins, prevProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Started: ${client.program_started_at}\n\n`;

  if (checkins.length > 0) {
    prompt += `Recent check-ins:\n`;
    for (const ci of checkins) {
      prompt += `- Week ${ci.week_no}: Weight=${ci.weight}kg, Waist=${ci.waist}cm, Compliance=${ci.compliance_score}/10, Energy=${ci.energy}/10`;
      if (ci.issues) prompt += `, Issues: ${ci.issues}`;
      prompt += '\n';
    }
    prompt += '\n';
  } else {
    prompt += `No previous check-ins (this is Week 1).\n\n`;
  }

  if (prevProgram) {
    prompt += `Previous week's plan summary:\n`;
    prompt += `Workout: ${JSON.stringify(prevProgram.workout_plan).slice(0, 500)}\n`;
    prompt += `Nutrition: calories=${prevProgram.nutrition_plan?.calories}, protein=${prevProgram.nutrition_plan?.protein_g}g\n`;
    if (prevProgram.notes) prompt += `Notes: ${prevProgram.notes}\n`;
    prompt += '\n';
  }

  prompt += `Create a progressive, well-structured program for Week ${weekNo}. Adjust difficulty and nutrition based on the check-in data.`;

  return prompt;
}

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 3 });
    doc.fontSize(12).fill(gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { characterSpacing: 2 });
    doc.fontSize(10).fill('#AAAAAA')
      .text(`${client.name || 'Client'} | ${new Date().toLocaleDateString('en-GB')}`, 50, 95);

    let y = 150;

    doc.fontSize(18).fill(gold).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (programData.workout_plan?.days) {
      for (const day of programData.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.rect(50, y, doc.page.width - 100, 22).fill('#F5F0E8');
        doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
          .text(`${day.day.toUpperCase()} — ${(day.focus || '').toUpperCase()}`, 60, y + 5);
        y += 28;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(charcoal).font('Helvetica')
              .text(`${ex.name}`, 70, y);
            doc.fill('#6B6B6B')
              .text(`${ex.sets} x ${ex.reps} | Rest: ${ex.rest || '60s'}`, 300, y);
            y += 16;
            if (ex.notes) {
              doc.fontSize(8).fill('#999999')
                .text(ex.notes, 70, y);
              y += 12;
            }
          }
        }
        y += 10;
      }
    }

    if (y > 600) { doc.addPage(); y = 50; }
    y += 20;
    doc.fontSize(18).fill(gold).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    const np = programData.nutrition_plan;
    if (np) {
      doc.rect(50, y, doc.page.width - 100, 50).fill('#F5F0E8');
      doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
        .text(`Calories: ${np.calories} kcal   |   Protein: ${np.protein_g}g   |   Carbs: ${np.carbs_g}g   |   Fat: ${np.fat_g}g`, 60, y + 10);
      doc.fontSize(9).fill('#6B6B6B').font('Helvetica')
        .text(`Hydration: ${np.hydration || '3-4 litres daily'}`, 60, y + 30);
      y += 60;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill(charcoal).font('Helvetica-Bold')
            .text(meal.meal, 60, y);
          y += 14;
          const options = Array.isArray(meal.options) ? meal.options : [meal.options];
          for (const opt of options) {
            doc.fontSize(9).fill('#6B6B6B').font('Helvetica')
              .text(`• ${opt}`, 70, y);
            y += 12;
          }
          y += 6;
        }
      }
    }

    if (programData.weekly_focus) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.fontSize(14).fill(gold).font('Helvetica-Bold')
        .text('WEEKLY FOCUS', 50, y);
      y += 22;
      doc.fontSize(10).fill(charcoal).font('Helvetica')
        .text(programData.weekly_focus, 50, y, { width: doc.page.width - 100 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#CCCCCC')
        .text('fitnessbymaddy.com | Confidential', 50, doc.page.height - 30, {
          width: doc.page.width - 100, align: 'center'
        });
    }

    doc.end();
  });
}
