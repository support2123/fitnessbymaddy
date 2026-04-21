const Anthropic = require('@anthropic-ai/sdk');
const { jsPDF } = require('jspdf');
const { getSupabase } = require('./_lib/supabase');
const { sendTextMessage, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone, PROGRAM_NAMES, errorResponse, jsonResponse } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) return errorResponse(res, 'Missing client_id or week_no');

    const { data: client } = await db
      .from('clients').select('*').eq('id', client_id).single();
    if (!client) return errorResponse(res, 'Client not found', 404);

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    try {
      const folderPath = client.folder_url || `clients/${client.id}`;
      const { data: intakeFile } = await db.storage
        .from('programs')
        .download(`${folderPath}/intake.json`);
      if (intakeFile) {
        intakeData = JSON.parse(await intakeFile.text());
      }
    } catch (e) { /* no intake data yet */ }

    const programPlan = await generateWithClaude(client, checkins || [], intakeData, week_no);

    if (programPlan.flagged) {
      await notifyMaddy('Program flagged for review',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nReason: ${programPlan.flagReason}`
      );
      await db.from('programs').insert({
        client_id, week_no,
        workout_plan: programPlan.workout,
        nutrition_plan: programPlan.nutrition,
        notes: `FLAGGED: ${programPlan.flagReason}`
      });
      return jsonResponse(res, { success: true, flagged: true });
    }

    const pdfBuffer = buildPDF(client, programPlan, week_no);

    const folderPath = client.folder_url || `clients/${client.id}`;
    const pdfPath = `${folderPath}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) throw uploadError;

    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { error: insertError } = await db.from('programs').insert({
      client_id, week_no,
      pdf_url: pdfUrl,
      workout_plan: programPlan.workout,
      nutrition_plan: programPlan.nutrition,
      notes: programPlan.coachNote
    });
    if (insertError) throw insertError;

    const market = detectMarket(client.phone);
    const programLabel = PROGRAM_NAMES[client.program] || client.program;

    const msg = isHinglish(market)
      ? `📋 *Week ${week_no} Program Ready!*\n\n` +
        `${programPlan.coachNote || 'Naya week, naya plan!'}\n\n` +
        `📎 PDF: ${pdfUrl}\n\n` +
        `Koi doubt ho toh message karo. Let's go! 🔥`
      : `📋 *Week ${week_no} Program Ready!*\n\n` +
        `${programPlan.coachNote || 'New week, new plan!'}\n\n` +
        `📎 PDF: ${pdfUrl}\n\n` +
        `Questions? Just message us. Let's crush it! 🔥`;

    await sendTextMessage(client.phone, msg);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return jsonResponse(res, { success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};

async function generateWithClaude(client, checkins, intakeData, weekNo) {
  const anthropic = new Anthropic();

  const lastCheckin = checkins[0] || null;
  const prevCheckin = checkins[1] || null;

  const prompt = `You are a world-class fitness coach and program architect for "Fitness by Maddy".

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
${intakeData ? `- Age: ${intakeData.age}, Gender: ${intakeData.gender}
- Goal: ${intakeData.goal}
- Injuries/conditions: ${intakeData.injuries || 'None'}
- Medical conditions: ${intakeData.medical_conditions || 'None'}
- Diet preference: ${intakeData.diet_preference || 'No restriction'}
- Experience: ${intakeData.workout_experience || 'Intermediate'}
- Equipment: ${intakeData.available_equipment || 'Full gym'}
- Schedule: ${intakeData.weekly_schedule || '5 days/week'}
- Current weight: ${intakeData.current_weight || 'N/A'}
- Target weight: ${intakeData.target_weight || 'N/A'}` : '- No intake data yet (use sensible defaults for an intermediate trainee)'}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

Generate a complete weekly program. Return ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...for each training day
    ],
    "cardio": { "type": "LISS/HIIT", "frequency": "3x/week", "duration": "25 min", "notes": "" },
    "restDays": "Wednesday, Sunday"
  },
  "nutrition": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fats": 65,
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "options": ["Option 1 description", "Option 2 description"] }
    ],
    "supplements": ["Creatine 5g daily", "..."],
    "hydration": "3-4L water daily",
    "notes": ""
  },
  "coachNote": "One-liner motivational/contextual note for the WhatsApp message",
  "flagged": false,
  "flagReason": ""
}

SAFETY RULES (set flagged=true if violated):
- Never go below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme supplementation
- Never suggest training through injury pain
- Never promise specific weight loss timelines
- If client reports pain, dizziness, or disordered eating: flag immediately

Progressively overload from previous weeks. Adjust based on compliance and energy.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse program JSON from Claude');

  return JSON.parse(jsonMatch[0]);
}

function buildPDF(client, plan, weekNo) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Header bar
  doc.setFillColor(44, 44, 44);
  doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setFillColor(184, 150, 90);
  doc.rect(0, 40, pageWidth, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('FITNESS BY MADDY', margin, 20);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Week ${weekNo} Program | ${client.name || 'Client'}`, margin, 32);

  y = 52;

  // Workout section
  doc.setTextColor(184, 150, 90);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('WORKOUT PLAN', margin, y);
  y += 10;

  if (plan.workout?.days) {
    for (const day of plan.workout.days) {
      if (y > 260) { doc.addPage(); y = margin; }

      doc.setFillColor(245, 241, 235);
      doc.rect(margin, y - 5, contentWidth, 8, 'F');
      doc.setTextColor(44, 44, 44);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`${day.day} — ${day.focus}`, margin + 2, y);
      y += 8;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);

      for (const ex of day.exercises || []) {
        if (y > 275) { doc.addPage(); y = margin; }
        const line = `${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`;
        doc.text(line, margin + 4, y);
        if (ex.notes) {
          doc.setTextColor(150, 150, 150);
          doc.text(`  ${ex.notes}`, margin + 4, y + 4);
          y += 4;
        }
        doc.setTextColor(100, 100, 100);
        y += 5;
      }
      y += 4;
    }
  }

  if (plan.workout?.cardio) {
    if (y > 250) { doc.addPage(); y = margin; }
    doc.setTextColor(184, 150, 90);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('CARDIO', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(9);
    const c = plan.workout.cardio;
    doc.text(`${c.type} | ${c.frequency} | ${c.duration}`, margin + 4, y);
    y += 10;
  }

  // Nutrition section
  doc.addPage();
  y = margin;

  doc.setFillColor(44, 44, 44);
  doc.rect(0, 0, pageWidth, 12, 'F');
  doc.setFillColor(184, 150, 90);
  doc.rect(0, 12, pageWidth, 2, 'F');
  y = 24;

  doc.setTextColor(184, 150, 90);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('NUTRITION PLAN', margin, y);
  y += 10;

  if (plan.nutrition) {
    const n = plan.nutrition;

    doc.setFillColor(245, 241, 235);
    doc.rect(margin, y - 4, contentWidth, 10, 'F');
    doc.setTextColor(44, 44, 44);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Calories: ${n.calories}  |  P: ${n.protein}g  |  C: ${n.carbs}g  |  F: ${n.fats}g`, margin + 2, y + 2);
    y += 14;

    if (n.meals) {
      for (const meal of n.meals) {
        if (y > 260) { doc.addPage(); y = margin; }

        doc.setTextColor(44, 44, 44);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(`${meal.meal} (${meal.time || ''})`, margin, y);
        y += 6;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        for (const opt of meal.options || []) {
          if (y > 275) { doc.addPage(); y = margin; }
          const lines = doc.splitTextToSize(`• ${opt}`, contentWidth - 8);
          doc.text(lines, margin + 4, y);
          y += lines.length * 4 + 2;
        }
        y += 3;
      }
    }

    if (n.supplements?.length) {
      if (y > 250) { doc.addPage(); y = margin; }
      doc.setTextColor(184, 150, 90);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('SUPPLEMENTS', margin, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      for (const s of n.supplements) {
        doc.text(`• ${s}`, margin + 4, y);
        y += 5;
      }
      y += 6;
    }

    if (n.hydration) {
      doc.setTextColor(44, 44, 44);
      doc.setFontSize(9);
      doc.text(`Hydration: ${n.hydration}`, margin, y);
    }
  }

  // Footer on last page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(44, 44, 44);
    doc.rect(0, 290, pageWidth, 7, 'F');
    doc.setTextColor(150, 150, 150);
    doc.setFontSize(7);
    doc.text('fitnessbymaddy.com | Personalized coaching', margin, 294);
    doc.text(`Page ${i}/${pageCount}`, pageWidth - margin - 20, 294);
  }

  return Buffer.from(doc.output('arraybuffer'));
}
