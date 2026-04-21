const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /steroids?/i,
  /sarms?/i,
  /lose\s*\d+\s*kg\s*in\s*[1-3]\s*day/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    const anthropic = new Anthropic();

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(client, recentCheckins || [], prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const fullText = JSON.stringify(parsed);
    const isUnsafe = UNSAFE_PATTERNS.some((p) => p.test(fullText));
    if (isUnsafe) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        client.phone,
        'Unsafe content detected in generated program',
        `Week ${week_no}: Content flagged by safety filter`
      );
      return res.status(200).json({ flagged: true, reason: 'unsafe_content' });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program } = await supabase
      .from('programs')
      .upsert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan || parsed.workout || {},
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition || {},
        notes: parsed.notes || null,
        pdf_url: pdfUrl,
        generated_at: new Date().toISOString(),
      }, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    const market = detectMarket(client.phone);
    const contextNote = parsed.notes || `Week ${week_no} program ready`;

    await sendTemplate(
      client.phone,
      isHinglish(market) ? 'program_ready_hi' : 'program_ready_en',
      [client.name || 'there', String(week_no), contextNote],
      true
    );

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildSystemPrompt() {
  return `You are a NASM-certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You generate weekly personalized workout and nutrition plans.

RULES:
- Never prescribe below 1400 calories for women or 1600 for men
- Never recommend banned substances, steroids, SARMs, or extreme measures
- Always include progressive overload rationale
- Base nutrition on whole foods; allow flexible dieting within macros
- Adjust based on check-in compliance, energy, and any reported issues
- Consider injuries, medical conditions, and experience level
- Be realistic about timelines — no crash diets, no "lose 10kg in a week"

OUTPUT FORMAT: Return a single JSON object with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
      ]}
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 60,
    "meal_template": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-line context note for the client about this week's focus"
}`;
}

function buildUserPrompt(client, checkins, prevProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for:\n`;
  prompt += `- Name: ${client.name || 'Client'}\n`;
  prompt += `- Program: ${client.program}\n`;
  prompt += `- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}\n\n`;

  if (checkins.length > 0) {
    prompt += 'Recent check-in data:\n';
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: weight=${c.weight || 'N/A'}, waist=${c.waist || 'N/A'}, `;
      prompt += `compliance=${c.compliance_score || 'N/A'}/10, energy=${c.energy || 'N/A'}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      prompt += '\n';
    }
  } else {
    prompt += 'No previous check-in data available (first week).\n';
  }

  if (prevProgram) {
    prompt += `\nPrevious week plan summary:\n`;
    prompt += `  Workout: ${JSON.stringify(prevProgram.workout_plan).slice(0, 500)}\n`;
    prompt += `  Nutrition: ${JSON.stringify(prevProgram.nutrition_plan).slice(0, 500)}\n`;
  }

  prompt += '\nGenerate the complete program JSON.';
  return prompt;
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header — black background with gold text
    doc.rect(0, 0, 595, 100).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESSBYMADDY', 50, 30, { align: 'left' });
    doc.fontSize(12).fill('#FFFFFF').text(
      `${client.name || 'Client'} — Week ${weekNo} Program`,
      50, 65,
      { align: 'left' }
    );

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    // Workout Plan
    const workout = programData.workout_plan || programData.workout;
    if (workout?.days) {
      doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);

      for (const day of workout.days) {
        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#6B6B6B').text(
              `  ${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest || '60s'}${ex.notes ? ' | ' + ex.notes : ''}`,
              70
            );
          }
        }
        doc.moveDown(0.5);
      }

      if (workout.cardio) {
        doc.fontSize(11).fill('#2C2C2C').text(`Cardio: ${workout.cardio}`, 50);
      }
    }

    doc.moveDown(1);

    // Nutrition Plan
    const nutrition = programData.nutrition_plan || programData.nutrition;
    if (nutrition) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);

      doc.fontSize(11).fill('#2C2C2C').text(
        `Daily Targets: ${nutrition.calories || '—'} cal | ${nutrition.protein_g || '—'}g protein | ${nutrition.carbs_g || '—'}g carbs | ${nutrition.fat_g || '—'}g fat`,
        50
      );
      doc.moveDown(0.5);

      if (nutrition.meal_template) {
        for (const meal of nutrition.meal_template) {
          doc.fontSize(11).fill('#2C2C2C').text(`${meal.meal}:`, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`  • ${opt}`, 70);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (nutrition.supplements?.length > 0) {
        doc.moveDown(0.3);
        doc.fontSize(11).fill('#2C2C2C').text(`Supplements: ${nutrition.supplements.join(', ')}`, 50);
      }

      if (nutrition.hydration) {
        doc.fontSize(11).fill('#2C2C2C').text(`Hydration: ${nutrition.hydration}`, 50);
      }
    }

    // Notes
    if (programData.notes) {
      doc.moveDown(1);
      doc.fontSize(11).fill('#B8965A').text('Coach Notes:', 50);
      doc.fontSize(10).fill('#6B6B6B').text(programData.notes, 50);
    }

    // Footer
    const pageH = doc.page.height;
    doc.rect(0, pageH - 40, 595, 40).fill('#2C2C2C');
    doc.fontSize(8).fill('#B8965A').text(
      'FitnessByMaddy — fitnessbymaddy.com — Powered by Science, Driven by Results',
      50,
      pageH - 28,
      { align: 'center' }
    );

    doc.end();
  });
}
