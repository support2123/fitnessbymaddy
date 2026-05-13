const { getSupabase } = require('./lib/supabase');
const { sendTemplateForced, notifyMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/escalation');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 calories', 'starvation',
  'banned substance', 'steroid', 'sarm', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'crash diet', 'water fast',
  'ignore pain', 'push through injury'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const prompt = buildProgramPrompt(client, recentCheckins || [], prevPrograms || [], week_no);

    const claudeResponse = await callClaudeAPI(prompt);
    if (!claudeResponse) {
      return res.status(500).json({ error: 'Claude API call failed' });
    }

    const parsed = parseProgramResponse(claudeResponse);

    if (hasSafetyIssues(claudeResponse)) {
      await notifyMaddy(
        'Program safety flag',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nFlagged content detected — review before sending.`
      );
      await supabase.from('programs').upsert({
        client_id, week_no,
        workout_plan: parsed.workout,
        nutrition_plan: parsed.nutrition,
        notes: 'FLAGGED: Requires Maddy review before sending',
        generated_at: new Date().toISOString()
      }, { onConflict: 'client_id,week_no' });
      return res.status(200).json({ ok: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || '';

    await supabase.from('programs').upsert({
      client_id,
      week_no,
      workout_plan: parsed.workout,
      nutrition_plan: parsed.nutrition,
      notes: parsed.notes,
      pdf_url: pdfUrl,
      generated_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' });

    const sendResult = await sendTemplateForced(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(week_no),
        parsed.notes || 'Your new weekly program is ready!'
      ],
      media: pdfUrl ? { url: pdfUrl, filename: `week_${week_no}_program.pdf` } : {}
    });

    if (sendResult.ok) {
      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('client_id', client_id).eq('week_no', week_no);
    }

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, prevPrograms, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];
  const prevProgram = prevPrograms[0];

  let context = `You are a certified personal trainer and nutrition coach creating a weekly training and nutrition program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12

`;

  if (lastCheckin) {
    context += `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None reported'}

`;
  }

  if (prevCheckin) {
    context += `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10

`;
  }

  if (prevProgram) {
    context += `PREVIOUS PROGRAM (Week ${prevProgram.week_no}):
${JSON.stringify(prevProgram.workout_plan, null, 2).substring(0, 500)}

`;
  }

  context += `OUTPUT FORMAT:
Return a JSON object with exactly this structure:
{
  "workout": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": "3x per week, 20-25min moderate intensity",
    "notes": "..."
  },
  "nutrition": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 73,
    "meal_plan": [
      { "meal": "Breakfast", "options": ["..."] },
      ...
    ],
    "supplements": ["..."],
    "notes": "..."
  },
  "notes": "Brief 1-liner context for WhatsApp message"
}

RULES:
- Be evidence-based and conservative.
- No extreme calorie deficits (minimum 1200 for women, 1500 for men).
- No banned substances or supplements.
- Adjust based on check-in data: if compliance is low, simplify. If energy is low, reduce volume or add rest days.
- Progress from previous week — don't repeat the same program.`;

  return context;
}

async function callClaudeAPI(prompt) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('CLAUDE_API_KEY not configured');
    return null;
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    return data.content?.[0]?.text || null;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return null;
  }
}

function parseProgramResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        workout: parsed.workout || {},
        nutrition: parsed.nutrition || {},
        notes: parsed.notes || ''
      };
    }
  } catch (e) {
    console.error('Failed to parse program JSON:', e.message);
  }
  return { workout: {}, nutrition: {}, notes: '' };
}

function hasSafetyIssues(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 100).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 30, { align: 'left' });
    doc.fontSize(12).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program | ${client.name || 'Client'}`, 50, 65, { align: 'left' });

    doc.moveDown(3);

    // Workout Section
    doc.fillColor('#2C2C2C').fontSize(20).text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').stroke();
    doc.moveDown(0.5);

    const workout = program.workout;
    if (workout.days) {
      for (const day of workout.days) {
        doc.fillColor('#B8965A').fontSize(14).text(day.day.toUpperCase() + ' — ' + (day.focus || ''), 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fillColor('#2C2C2C').fontSize(10)
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60);
            if (ex.notes) {
              doc.fillColor('#6B6B6B').fontSize(9).text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);

        if (doc.y > 700) {
          doc.addPage();
        }
      }
    }

    if (workout.cardio) {
      doc.moveDown(0.5);
      doc.fillColor('#2C2C2C').fontSize(11).text('Cardio: ' + workout.cardio, 50);
    }

    // Nutrition Section
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fontSize(20).fillColor('#B8965A').text('NUTRITION PLAN', 50, 20);

    doc.moveDown(2);

    const nutrition = program.nutrition;
    if (nutrition.calories) {
      doc.fillColor('#2C2C2C').fontSize(12);
      doc.text(`Daily Calories: ${nutrition.calories} kcal`, 50);
      doc.text(`Protein: ${nutrition.protein_g || '—'}g  |  Carbs: ${nutrition.carbs_g || '—'}g  |  Fat: ${nutrition.fat_g || '—'}g`, 50);
      doc.moveDown();
    }

    if (nutrition.meal_plan) {
      for (const meal of nutrition.meal_plan) {
        doc.fillColor('#B8965A').fontSize(12).text(meal.meal, 50);
        if (meal.options) {
          for (const opt of meal.options) {
            doc.fillColor('#2C2C2C').fontSize(10).text(`  • ${opt}`, 60);
          }
        }
        doc.moveDown(0.3);
      }
    }

    if (nutrition.supplements && nutrition.supplements.length) {
      doc.moveDown();
      doc.fillColor('#B8965A').fontSize(12).text('Supplements', 50);
      for (const supp of nutrition.supplements) {
        doc.fillColor('#2C2C2C').fontSize(10).text(`  • ${supp}`, 60);
      }
    }

    // Footer
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
    doc.moveDown(0.5);
    doc.fillColor('#6B6B6B').fontSize(9)
      .text('This program is personalised for you by Fitness by Maddy. Do not share or redistribute.', 50, doc.y, { align: 'center' });

    doc.end();
  });
}
