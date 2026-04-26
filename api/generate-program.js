const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarms|steroids/i,
  /lose\s*\d{2,}\s*kg\s*in\s*\d\s*week/i,
  /extreme\s*(cut|deficit|fast)/i
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

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: previousProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a world-class fitness program architect working for FitnessByMaddy,
a NASM-certified trainer. Generate a weekly training and nutrition plan.

RULES:
- Never suggest calorie intake below 1200 for women or 1500 for men
- Never recommend banned substances, steroids, SARMs, or dangerous supplements
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Prioritise safety for any reported injuries or conditions
- Adjust based on compliance score and energy levels from check-ins
- Be specific: exact exercises, sets, reps, rest periods
- Include warm-up and cool-down in every session
- Nutrition: provide macro targets and 3 meal options per slot

OUTPUT FORMAT: Valid JSON with these keys:
{
  "workout_plan": {
    "summary": "...",
    "days": [{ "day": "Monday", "focus": "...", "exercises": [...], "notes": "..." }]
  },
  "nutrition_plan": {
    "summary": "...",
    "calories": ...,
    "protein_g": ...,
    "carbs_g": ...,
    "fat_g": ...,
    "meals": [{ "slot": "Breakfast", "options": [...] }]
  },
  "notes": "..."
}`;

    const userPrompt = buildUserPrompt(client, recentCheckins, previousProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(rawText)) {
        await supabase.from('programs').insert({
          client_id, week_no, notes: `FLAGGED: ${pattern.toString()} matched. Awaiting Maddy review.`,
          workout_plan: {}, nutrition_plan: {}
        });
        const { sendEscalation } = require('./_lib/whatsapp');
        await sendEscalation('risky_program_content', client.phone, `Week ${week_no} program flagged for review`);
        return res.status(200).json({ action: 'flagged_for_review', week_no });
      }
    }

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (e) {
      console.error('Failed to parse Claude response:', e.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: parsed.workout_plan || {},
      nutrition_plan: parsed.nutrition_plan || {},
      notes: parsed.notes || null
    }).select().single();

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: `Your Week ${week_no} program is ready! ${parsed.notes || 'Let\'s crush it this week!'}`,
      params: [week_no.toString(), client.name || 'Champion'],
      isClient: true
    });

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({
      success: true,
      programId: program.id,
      pdfUrl: publicUrl?.publicUrl || pdfPath
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function buildUserPrompt(client, checkins, previousProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for client:\n`;
  prompt += `- Name: ${client.name || 'Client'}\n`;
  prompt += `- Program: ${client.program}\n`;
  prompt += `- Phone market: ${client.phone?.startsWith('+91') ? 'India' : 'International'}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, `;
      prompt += `compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  if (previousProgram) {
    prompt += `\nPrevious week plan summary: ${JSON.stringify(previousProgram.workout_plan?.summary || 'First week')}\n`;
  }

  prompt += `\nGenerate the complete program as JSON.`;
  return prompt;
}

function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#D4AF7A')
      .text(`Prepared for ${client.name || 'Client'}`, 50, 95, { align: 'center' });

    doc.moveDown(3);

    if (plan.workout_plan) {
      doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', { underline: true });
      doc.moveDown(0.5);

      if (plan.workout_plan.summary) {
        doc.fontSize(11).fill('#6B6B6B').text(plan.workout_plan.summary);
        doc.moveDown(0.5);
      }

      if (plan.workout_plan.days) {
        for (const day of plan.workout_plan.days) {
          doc.moveDown(0.3);
          doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus || ''}`);

          if (day.exercises) {
            for (const ex of day.exercises) {
              const exText = typeof ex === 'string' ? ex
                : `${ex.name || ex.exercise || ''} — ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? `(Rest: ${ex.rest})` : ''}`;
              doc.fontSize(10).fill('#2C2C2C').text(`  • ${exText}`);
            }
          }

          if (day.notes) {
            doc.fontSize(9).fill('#6B6B6B').text(`    Note: ${day.notes}`);
          }
        }
      }
    }

    doc.moveDown(1.5);

    if (plan.nutrition_plan) {
      doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', { underline: true });
      doc.moveDown(0.5);

      if (plan.nutrition_plan.summary) {
        doc.fontSize(11).fill('#6B6B6B').text(plan.nutrition_plan.summary);
        doc.moveDown(0.3);
      }

      const macros = [];
      if (plan.nutrition_plan.calories) macros.push(`Calories: ${plan.nutrition_plan.calories}`);
      if (plan.nutrition_plan.protein_g) macros.push(`Protein: ${plan.nutrition_plan.protein_g}g`);
      if (plan.nutrition_plan.carbs_g) macros.push(`Carbs: ${plan.nutrition_plan.carbs_g}g`);
      if (plan.nutrition_plan.fat_g) macros.push(`Fat: ${plan.nutrition_plan.fat_g}g`);

      if (macros.length) {
        doc.fontSize(11).fill('#2C2C2C').text(`Daily Targets: ${macros.join(' | ')}`);
        doc.moveDown(0.5);
      }

      if (plan.nutrition_plan.meals) {
        for (const meal of plan.nutrition_plan.meals) {
          doc.fontSize(12).fill('#B8965A').text(meal.slot || meal.name || '');
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#2C2C2C').text(`  • ${typeof opt === 'string' ? opt : JSON.stringify(opt)}`);
            }
          }
          doc.moveDown(0.3);
        }
      }
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#C8B89A')
      .text('This program is personalised for you by FitnessByMaddy. Do not share or redistribute.', {
        align: 'center'
      });

    doc.end();
  });
}
