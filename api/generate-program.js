const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendMedia, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, jsonResponse, errorResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return errorResponse(res, 'Method not allowed', 405);

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) return errorResponse(res, 'client_id and week_no required');

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return errorResponse(res, 'Client not found', 404);

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
      return jsonResponse(res, { status: 'already_exists', program_id: existingProgram.id });
    }

    const anthropic = new Anthropic();

    const systemPrompt = `You are an expert fitness program architect for FitnessByMaddy coaching.
You create personalised weekly workout and nutrition plans based on client data.

RULES:
- Never prescribe extreme calorie deficits (below 1200 cal for women, 1500 for men)
- Never recommend banned or dangerous substances
- Never promise unrealistic timelines
- Always include rest days
- Adapt difficulty based on compliance score and energy levels
- If the client reports pain or injury, reduce intensity in affected areas
- Output valid JSON only`;

    const userPrompt = buildPrompt(client, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    let programData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      programData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse Claude response:', e.message);
      await notifyMaddy(
        'Program generation failed - parse error',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}`
      );
      return errorResponse(res, 'Failed to parse program', 500);
    }

    if (isSafetyFlagged(programData)) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nReason: Content flagged by safety check`
      );
      return errorResponse(res, 'Program flagged for review', 422);
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
      return errorResponse(res, 'Failed to upload PDF', 500);
    }

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData.publicUrl;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout || programData.workout_plan || {},
      nutrition_plan: programData.nutrition || programData.nutrition_plan || {},
      notes: programData.notes || null
    }).select().single();

    const contextNote = buildContextNote(programData, week_no, recentCheckins);
    await sendMedia(client.phone, pdfUrl, contextNote);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return jsonResponse(res, { status: 'ok', program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};

function buildPrompt(client, checkins, weekNo) {
  let prompt = `Generate a Week ${weekNo} program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Unknown'}
- Program: ${client.program}
- Started: ${client.program_started_at}
`;

  if (checkins && checkins.length > 0) {
    prompt += '\nRECENT CHECK-INS:\n';
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10, Issues: ${c.issues || 'None'}\n`;
    }
  }

  prompt += `
Return a JSON object with this structure:
{
  "workout_plan": {
    "summary": "Brief overview",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "20 min LISS"
      }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "notes": "Any specific nutrition notes"
  },
  "notes": "Week focus and motivation",
  "adjustments": "What changed from last week and why"
}`;

  return prompt;
}

function isSafetyFlagged(programData) {
  const nutrition = programData.nutrition || programData.nutrition_plan || {};
  if (nutrition.calories && nutrition.calories < 1200) return true;

  const allText = JSON.stringify(programData).toLowerCase();
  const banned = ['steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra', 'hgh injection'];
  for (const word of banned) {
    if (allText.includes(word)) return true;
  }

  return false;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 72);
    doc.fontSize(10).fill('#999999').text(`${client.name || 'Client'} | ${client.program?.replace(/_/g, ' ').toUpperCase()}`, 50, 92);

    let y = 145;

    const workout = programData.workout_plan || programData.workout || {};
    if (workout.summary) {
      doc.fontSize(10).fill('#666666').text(workout.summary, 50, y, { width: 495 });
      y += 30;
    }

    if (workout.days) {
      doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.rect(50, y, 495, 22).fill('#F0EAE0');
        doc.fontSize(11).fill('#2C2C2C').text(`${day.day} — ${day.focus || ''}`, 58, y + 5);
        y += 28;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            doc.fontSize(9).fill('#2C2C2C')
              .text(ex.name, 60, y)
              .text(`${ex.sets} x ${ex.reps}`, 280, y)
              .text(`Rest: ${ex.rest || '60s'}`, 380, y);
            if (ex.notes) {
              doc.fontSize(8).fill('#999999').text(ex.notes, 60, y + 12, { width: 480 });
              y += 12;
            }
            y += 16;
          }
        }
        if (day.cardio) {
          doc.fontSize(9).fill('#B8965A').text(`Cardio: ${day.cardio}`, 60, y);
          y += 18;
        }
        y += 8;
      }
    }

    const nutrition = programData.nutrition_plan || programData.nutrition || {};
    if (nutrition.calories) {
      if (y > 600) { doc.addPage(); y = 50; }

      doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50, y);
      y += 30;

      doc.rect(50, y, 495, 40).fill('#F0EAE0');
      doc.fontSize(10).fill('#2C2C2C');
      doc.text(`Calories: ${nutrition.calories}`, 60, y + 6);
      doc.text(`Protein: ${nutrition.protein_g}g`, 200, y + 6);
      doc.text(`Carbs: ${nutrition.carbs_g}g`, 320, y + 6);
      doc.text(`Fat: ${nutrition.fat_g}g`, 440, y + 6);
      y += 50;

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 730) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill('#B8965A').text(meal.meal, 60, y);
          y += 14;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill('#666666').text(`• ${opt}`, 70, y, { width: 470 });
              y += 14;
            }
          }
          y += 6;
        }
      }
    }

    if (programData.notes) {
      if (y > 700) { doc.addPage(); y = 50; }
      y += 10;
      doc.fontSize(18).fill('#2C2C2C').text('NOTES', 50, y);
      y += 25;
      doc.fontSize(10).fill('#666666').text(programData.notes, 50, y, { width: 495 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#CCCCCC')
        .text(`fitnessbymaddy.com | Week ${weekNo} | Page ${i + 1}/${pageCount}`,
          50, doc.page.height - 30, { width: 495, align: 'center' });
    }

    doc.end();
  });
}

function buildContextNote(programData, weekNo, checkins) {
  const adj = programData.adjustments || '';
  const lastCheckin = checkins?.[0];

  let note = `📋 Week ${weekNo} Program`;
  if (adj) note += `\n${adj}`;
  if (lastCheckin && lastCheckin.compliance_score) {
    note += `\nLast week compliance: ${lastCheckin.compliance_score}/10`;
  }
  note += '\n💪 Let\'s go!';
  return note;
}
