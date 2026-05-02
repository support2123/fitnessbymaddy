const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { handleCors, maskPhone, programDisplayName } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(200).json({ ok: true, message: 'Program already exists', id: existingProgram.id });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(client, recentCheckins || [], week_no);

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      await notifyMaddy(
        'Program generation parse error',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nResponse was not valid JSON`
      );
      return res.status(500).json({ error: 'AI response parse error' });
    }

    if (hasSafetyIssues(parsed)) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReason: Potentially unsafe recommendations detected`
      );
      return res.status(200).json({ ok: false, message: 'Flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: parsed.workout_plan || parsed.workouts,
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition,
      notes: parsed.notes || null
    }).select().single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      parsed.notes || `Your Week ${week_no} program is ready!`
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ ok: true, program_id: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildSystemPrompt() {
  return `You are a NASM-certified fitness program architect for Fitness by Maddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Programs must be safe, evidence-based, and progressive
- Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances, fat burners, or unproven supplements
- Never promise specific weight loss timelines
- Adjust based on check-in data: compliance, energy, issues reported
- Include rest days and deload weeks as appropriate
- Consider injuries and limitations mentioned in the client profile

OUTPUT FORMAT: Return a single JSON object with this structure:
{
  "workout_plan": {
    "overview": "Brief description of this week's focus",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fat_g": 70,
    "meal_timing": ["Meal 1 - 8am: ...", "Meal 2 - 12pm: ..."],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "One line summary for WhatsApp message"
}`;
}

function buildUserPrompt(client, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;
  prompt += `Program: ${programDisplayName(client.program)}\n`;
  prompt += `Goal: ${client.goal || 'general fitness'}\n`;

  if (client.age) prompt += `Age: ${client.age}\n`;
  if (client.injuries) prompt += `Injuries/Limitations: ${client.injuries}\n`;
  if (client.diet_pref) prompt += `Diet Preference: ${client.diet_pref}\n`;
  if (client.schedule) prompt += `Schedule: ${client.schedule}\n`;

  if (checkins.length > 0) {
    prompt += `\nRecent Check-in Data:\n`;
    checkins.forEach(c => {
      prompt += `  Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, `;
      prompt += `Waist ${c.waist || 'N/A'}cm, `;
      prompt += `Compliance ${c.compliance_score || 'N/A'}/10, `;
      prompt += `Energy ${c.energy || 'N/A'}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      if (c.next_week_focus) prompt += `, Focus: ${c.next_week_focus}`;
      prompt += `\n`;
    });
  }

  if (weekNo === 1) {
    prompt += `\nThis is Week 1 — create a baseline program that assesses their starting level.`;
  } else if (weekNo % 4 === 0) {
    prompt += `\nThis is a deload week (Week ${weekNo}) — reduce volume by 30-40%.`;
  }

  return prompt;
}

function hasSafetyIssues(parsed) {
  const nutrition = parsed.nutrition_plan || parsed.nutrition || {};
  if (nutrition.calories && nutrition.calories < 1200) return true;

  const notes = JSON.stringify(parsed).toLowerCase();
  const banned = ['dnp', 'clenbuterol', 'ephedra', 'sarm', 'steroid', 'hgh injection'];
  return banned.some(term => notes.includes(term));
}

async function generatePDF(client, program, weekNo) {
  const PDFDocument = require('pdfkit');

  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill(gold)
      .text(`Week ${weekNo} Program`, 50, 75);
    doc.fontSize(10).fill('#999999')
      .text(`Prepared for ${client.name || 'Client'} | ${new Date().toLocaleDateString()}`, 50, 95);

    doc.moveDown(3);

    const workout = program.workout_plan || program.workouts || {};

    if (workout.overview) {
      doc.fontSize(10).fill(charcoal).font('Helvetica')
        .text(workout.overview, 50, doc.y, { width: 495 });
      doc.moveDown();
    }

    doc.fontSize(16).fill(gold).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, doc.y);
    doc.moveDown(0.5);

    const days = workout.days || [];
    for (const day of days) {
      if (doc.y > 700) {
        doc.addPage();
        doc.y = 50;
      }

      doc.fontSize(12).fill(charcoal).font('Helvetica-Bold')
        .text(`${day.day} — ${day.focus || ''}`, 50, doc.y);
      doc.moveDown(0.3);

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        doc.fontSize(9).fill('#444444').font('Helvetica')
          .text(
            `  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}${ex.notes ? '  |  ' + ex.notes : ''}`,
            60, doc.y, { width: 475 }
          );
        doc.moveDown(0.2);
      }
      doc.moveDown(0.5);
    }

    const nutrition = program.nutrition_plan || program.nutrition || {};

    if (doc.y > 600) doc.addPage();

    doc.moveDown();
    doc.fontSize(16).fill(gold).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, doc.y);
    doc.moveDown(0.5);

    if (nutrition.calories) {
      doc.fontSize(10).fill(charcoal).font('Helvetica-Bold')
        .text(`Daily Targets: ${nutrition.calories} kcal | P: ${nutrition.protein_g || '—'}g | C: ${nutrition.carbs_g || '—'}g | F: ${nutrition.fat_g || '—'}g`, 50, doc.y);
      doc.moveDown(0.5);
    }

    const meals = nutrition.meal_timing || [];
    for (const meal of meals) {
      doc.fontSize(9).fill('#444444').font('Helvetica')
        .text(`  ${meal}`, 60, doc.y, { width: 475 });
      doc.moveDown(0.3);
    }

    if (nutrition.hydration) {
      doc.moveDown(0.3);
      doc.fontSize(9).fill('#444444').text(`  Hydration: ${nutrition.hydration}`, 60, doc.y);
    }

    if (nutrition.supplements && nutrition.supplements.length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(9).fill('#444444').text(`  Supplements: ${nutrition.supplements.join(', ')}`, 60, doc.y);
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#999999').font('Helvetica')
      .text('This program is personalized for you by Fitness by Maddy. Do not share or redistribute.', 50, doc.y, { align: 'center', width: 495 });

    doc.end();
  });
}
