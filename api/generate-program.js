const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendFreeform, notifyMaddy } = require('./lib/whatsapp');
const { maskPhone, parseBody, corsHeaders, json } = require('./lib/utils');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 calories', 'under 800 calories',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in 2 weeks',
  'starvation', 'fasting for 7 days'
];

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return json(res, { error: 'client_id and week_no required' }, 400);
    }

    const sb = getSupabase();

    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return json(res, { error: 'client not found' }, 404);

    const { data: recentCheckins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await sb
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram, week_no);

    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    if (SAFETY_FLAGS.some(flag => responseText.toLowerCase().includes(flag))) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nReason: Content matched safety filter`
      );
      return json(res, { ok: false, reason: 'flagged_for_review' });
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
      workoutPlan = parsed.workout_plan || parsed.workout;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = {};
      notes = '';
    }

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan, notes);

    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await sb.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = sb.storage.from('clients').getPublicUrl(filePath);

    const { error: insertError } = await sb.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }, { onConflict: 'client_id,week_no' });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
      return json(res, { error: 'save failed' }, 500);
    }

    const contextNote = notes
      ? `Week ${week_no} program ready! ${notes}`
      : `Week ${week_no} program is ready! Check your PDF for the full plan.`;

    const sendResult = await sendFreeform(
      client.phone,
      `${contextNote}\n\nPDF: ${publicUrl?.publicUrl || 'Check your client portal'}`,
      true
    );

    if (sendResult.ok) {
      await sb.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', parseInt(week_no));
    }

    return json(res, { ok: true, week_no, pdf_url: publicUrl?.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return json(res, { error: 'internal' }, 500);
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  return `You are Maddy's program architect — an expert fitness coach creating weekly personalized programs.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

LATEST CHECK-IN (Week ${lastCheckin.week_no || 'N/A'}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None reported'}

PREVIOUS CHECK-IN (Week ${prevCheckin.week_no || 'N/A'}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10

${prevProgram ? `LAST WEEK'S PLAN SUMMARY:
${JSON.stringify(prevProgram.workout_plan || {}).slice(0, 500)}
Coach notes: ${prevProgram.notes || 'None'}` : 'No previous program data available.'}

INSTRUCTIONS:
1. Design a complete 7-day workout plan with exercises, sets, reps, rest times
2. Design a nutrition plan with daily calorie target, macro split, and sample meals
3. Adapt based on compliance score and energy levels
4. If compliance is low (<6), simplify the plan
5. If energy is low (<5), reduce volume and add recovery days
6. Progress difficulty if compliance and energy are both high (>7)
7. Include a brief coach note with encouragement and focus area

SAFETY RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend supplements beyond basic protein/creatine/multivitamin
- Never suggest extreme training volumes (>90 min sessions)
- If the client reported pain or injury, reduce load on that area

Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "monday": { "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "10-12", "rest": "60s"}] },
    "tuesday": { ... },
    "wednesday": { ... },
    "thursday": { ... },
    "friday": { ... },
    "saturday": { ... },
    "sunday": { "focus": "Rest / Active Recovery", "exercises": [] }
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 65,
    "meals": [
      { "meal": "Breakfast", "example": "..." },
      { "meal": "Lunch", "example": "..." },
      { "meal": "Snack", "example": "..." },
      { "meal": "Dinner", "example": "..." }
    ]
  },
  "notes": "Brief coach note here"
}
\`\`\``;
}

async function generatePDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 100).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 50, 30, { align: 'left' });
    doc.fontSize(12).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM — ${(client.name || 'CLIENT').toUpperCase()}`, 50, 65, { align: 'left' });

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    // Coach notes
    if (notes) {
      doc.fontSize(14).fillColor('#B8965A').text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#2C2C2C').text(notes, 50, undefined, { width: 495 });
      doc.moveDown(1);
    }

    // Workout plan
    doc.fontSize(14).fillColor('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (workoutPlan && typeof workoutPlan === 'object' && !workoutPlan.raw) {
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      for (const day of days) {
        const dayPlan = workoutPlan[day];
        if (!dayPlan) continue;

        if (doc.y > 700) doc.addPage();

        doc.fontSize(11).fillColor('#2C2C2C')
          .text(`${day.toUpperCase()} — ${dayPlan.focus || ''}`, 50, undefined, { underline: true });
        doc.moveDown(0.3);

        if (dayPlan.exercises && dayPlan.exercises.length > 0) {
          for (const ex of dayPlan.exercises) {
            doc.fontSize(9).fillColor('#6B6B6B')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60);
          }
        } else {
          doc.fontSize(9).fillColor('#6B6B6B').text('  Rest day — active recovery encouraged', 60);
        }
        doc.moveDown(0.5);
      }
    } else if (workoutPlan?.raw) {
      doc.fontSize(9).fillColor('#2C2C2C').text(workoutPlan.raw.slice(0, 3000), 50, undefined, { width: 495 });
    }

    // Nutrition plan
    if (doc.y > 650) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(14).fillColor('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    if (nutritionPlan && typeof nutritionPlan === 'object') {
      if (nutritionPlan.daily_calories) {
        doc.fontSize(10).fillColor('#2C2C2C')
          .text(`Daily Calories: ${nutritionPlan.daily_calories} kcal`, 50);
        doc.text(`Protein: ${nutritionPlan.protein_g || '—'}g  |  Carbs: ${nutritionPlan.carbs_g || '—'}g  |  Fats: ${nutritionPlan.fats_g || '—'}g`, 50);
        doc.moveDown(0.5);
      }

      if (nutritionPlan.meals && nutritionPlan.meals.length > 0) {
        for (const meal of nutritionPlan.meals) {
          doc.fontSize(10).fillColor('#2C2C2C').text(`${meal.meal}:`, 50);
          doc.fontSize(9).fillColor('#6B6B6B').text(`  ${meal.example}`, 60);
          doc.moveDown(0.3);
        }
      }
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#C8B89A')
      .text('This program is personalized by Fitness by Maddy. Follow your plan, trust the process.', 50, undefined, { align: 'center', width: 495 });

    doc.end();
  });
}
