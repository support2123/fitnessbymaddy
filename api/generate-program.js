const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendText } = require('./_lib/whatsapp');
const { isHinglish } = require('./_lib/market');

const SYSTEM_PROMPT = `You are Maddy's AI program architect for FitnessByMaddy. You create weekly personalised workout and nutrition plans for clients.

RULES:
- Plans must be safe, evidence-based, and appropriate for the client's level
- NEVER recommend extreme calorie cuts (<1200 for women, <1500 for men)
- NEVER recommend banned substances or supplements without evidence
- NEVER promise specific weight loss timelines
- Include warm-up and cool-down in every workout
- Factor in reported injuries, energy levels, and compliance
- Progressively overload week over week
- Nutrition should be sustainable, not extreme

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ], "warmup": "...", "cooldown": "..." }
    ],
    "rest_days": ["Sunday"],
    "weekly_volume_note": "..."
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fats_g": 70,
    "meal_timing": [...],
    "hydration": "...",
    "supplements": [...],
    "notes": "..."
  },
  "coach_note": "Brief personalised note to the client about this week's focus",
  "safety_flag": false
}

Set safety_flag to true if anything about the client data concerns you (injury, extreme request, medical issue).`;

async function generatePDF(programData, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program — ${clientName || 'Client'}`, 50, 75);

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    if (programData.coach_note) {
      doc.fontSize(12).fillColor('#B8965A').text('COACH NOTE', 50);
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#2C2C2C').text(programData.coach_note, 50);
      doc.moveDown(1.5);
    }

    const workout = programData.workout_plan;
    if (workout?.days) {
      doc.fontSize(16).fillColor('#B8965A').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
      doc.moveDown(0.5);

      for (const day of workout.days) {
        if (doc.y > 680) { doc.addPage(); doc.y = 50; }
        doc.fontSize(12).fillColor('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc.fontSize(9).fillColor('#6B6B6B').text(`Warm-up: ${day.warmup}`, 60);
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (doc.y > 700) { doc.addPage(); doc.y = 50; }
            const line = `  • ${ex.name} — ${ex.sets}×${ex.reps} | Rest: ${ex.rest}`;
            doc.fontSize(9).fillColor('#2C2C2C').text(line, 60);
            if (ex.notes) {
              doc.fontSize(8).fillColor('#6B6B6B').text(`    ${ex.notes}`, 70);
            }
          }
        }

        if (day.cooldown) {
          doc.fontSize(9).fillColor('#6B6B6B').text(`Cool-down: ${day.cooldown}`, 60);
        }
        doc.moveDown(0.8);
      }
    }

    if (doc.y > 500) doc.addPage();

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      doc.fontSize(16).fillColor('#B8965A').text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
      doc.moveDown(0.5);

      doc.fontSize(10).fillColor('#2C2C2C');
      doc.text(`Daily Calories: ${nutrition.calories} kcal`, 50);
      doc.text(`Protein: ${nutrition.protein_g}g | Carbs: ${nutrition.carbs_g}g | Fats: ${nutrition.fats_g}g`, 50);
      doc.moveDown(0.5);

      if (nutrition.meal_timing?.length) {
        doc.fontSize(10).fillColor('#B8965A').text('Meal Timing:', 50);
        for (const meal of nutrition.meal_timing) {
          doc.fontSize(9).fillColor('#2C2C2C').text(`  • ${meal}`, 60);
        }
      }
      doc.moveDown(0.5);

      if (nutrition.hydration) {
        doc.fontSize(9).fillColor('#6B6B6B').text(`Hydration: ${nutrition.hydration}`, 50);
      }
      if (nutrition.notes) {
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor('#6B6B6B').text(nutrition.notes, 50);
      }
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#C8B89A')
        .text('fitnessbymaddy.com', 50, doc.page.height - 30, { align: 'center' });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const clientContext = {
      name: client.name,
      program: client.program,
      week_number: week_no,
      recent_checkins: recentCheckins || [],
      previous_program: prevProgram || null,
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate week ${week_no} program for this client:\n\n${JSON.stringify(clientContext, null, 2)}`,
      }],
    });

    const aiText = response.content[0]?.text || '';
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    if (programData.safety_flag) {
      const { notifyMaddy } = require('./_lib/whatsapp');
      await notifyMaddy(
        'Safety flag on generated program',
        `Client: ${client.name} (${client.id}), Week ${week_no}. AI flagged safety concern. Please review before sending.`
      );
      await supabase.from('programs').insert({
        client_id, week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'SAFETY_FLAG: Awaiting Maddy review',
      });
      return res.status(200).json({ ok: true, status: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(programData, client.name, week_no);
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note,
    });

    const market = client.phone ? require('./_lib/market').detectMarket(client.phone) : 'GLOBAL';
    const hinglish = isHinglish(market);
    const contextNote = programData.coach_note || '';
    const msg = hinglish
      ? `Hey ${client.name || 'there'}! 💪 Week ${week_no} ka program ready hai.\n\n${contextNote}\n\nPDF yahan se download karo — aur iss hafte full effort daalo!`
      : `Hey ${client.name || 'there'}! 💪 Your Week ${week_no} program is ready.\n\n${contextNote}\n\nDownload your PDF and give this week everything you've got!`;

    const sendResult = await sendText(client.phone, msg);

    if (sendResult.ok) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
