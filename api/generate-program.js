const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    if (client.lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('first_msg')
        .eq('id', client.lead_id)
        .maybeSingle();

      if (lead?.first_msg) {
        try { intakeData = JSON.parse(lead.first_msg); } catch {}
      }
    }

    const programData = await generateWithClaude(client, recentCheckins || [], intakeData, week_no);

    if (programData.flagged) {
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy({
        reason: 'AI program flagged for review — potentially unsafe recommendation',
        phone: client.phone,
        clientName: client.name,
        message: programData.flagReason
      });
      return res.status(200).json({ action: 'flagged_for_review', reason: programData.flagReason });
    }

    const pdfBuffer = await renderPDF(client, programData, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: { publicUrl } } = db.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const { error: insertError } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl || pdfPath,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.coachNote
    });

    if (insertError) {
      console.error('Program insert error:', insertError.message);
    }

    const msg = `Hey ${client.name || 'there'}! Your Week ${week_no} program is ready.\n\n${programData.coachNote}\n\nPDF: ${publicUrl || 'Check your email'}`;

    const sendResult = await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: msg
    });

    if (sendResult.sent) {
      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({ success: true, week_no, pdf_url: publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generateWithClaude(client, checkins, intakeData, weekNo) {
  const anthropic = new Anthropic();

  const clientProfile = {
    name: client.name,
    program: client.program,
    weekNumber: weekNo,
    startedAt: client.program_started_at,
    ...(intakeData ? {
      age: intakeData.age,
      gender: intakeData.gender,
      goal: intakeData.goal,
      injuries: intakeData.injuries,
      dietPref: intakeData.diet_pref,
      schedule: intakeData.schedule,
      currentWeight: intakeData.current_weight,
      targetWeight: intakeData.target_weight,
      experienceLevel: intakeData.experience_level
    } : {})
  };

  const checkinSummary = checkins.map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues
  }));

  const prompt = `You are a NASM-certified fitness coach creating a weekly program for a client.

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS:
${checkinSummary.length ? JSON.stringify(checkinSummary, null, 2) : 'No check-ins yet (Week 1)'}

Generate a complete Week ${weekNo} program. Return ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min light cardio + dynamic stretches",
        "cooldown": "5 min stretch"
      }
    ],
    "restDays": ["Wednesday", "Sunday"],
    "progressionNote": ""
  },
  "nutrition": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fats": 70,
    "mealPlan": [
      { "meal": "Breakfast", "options": ["Option A", "Option B"] }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein post-workout", "Creatine 5g daily"]
  },
  "coachNote": "One-liner context note for WhatsApp delivery",
  "flagged": false,
  "flagReason": ""
}

RULES:
- Tailor intensity to the client's check-in data and experience level
- If compliance is low, simplify the plan
- If energy is low, reduce volume slightly
- Never recommend extreme calorie cuts (below BMR - 500)
- Never recommend banned substances
- Never promise unrealistic timelines
- If anything seems medically risky, set "flagged": true with reason
- Keep nutrition culturally relevant (Indian options for IN-market clients)
- Provide progression from previous weeks if check-in data available`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Claude returned non-JSON response');

  const parsed = JSON.parse(jsonMatch[0]);

  if (parsed.nutrition?.calories && parsed.nutrition.calories < 1000) {
    parsed.flagged = true;
    parsed.flagReason = `Dangerously low calories: ${parsed.nutrition.calories}`;
  }

  return parsed;
}

async function renderPDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 40);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 78);

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    if (programData.workout?.days) {
      doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);

      for (const day of programData.workout.days) {
        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        if (day.warmup) {
          doc.fontSize(9).fill('#6B6B6B').text(`Warmup: ${day.warmup}`, 70);
        }
        for (const ex of (day.exercises || [])) {
          const line = `${ex.name}: ${ex.sets} x ${ex.reps} (rest ${ex.rest})`;
          doc.fontSize(10).fill('#2C2C2C').text(line, 70);
          if (ex.notes) doc.fontSize(8).fill('#6B6B6B').text(ex.notes, 90);
        }
        doc.moveDown(0.3);
      }
    }

    doc.moveDown(1);

    if (programData.nutrition) {
      doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);

      const n = programData.nutrition;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Calories: ${n.calories} | Protein: ${n.protein}g | Carbs: ${n.carbs}g | Fats: ${n.fats}g`, 50);
      doc.moveDown(0.3);

      if (n.mealPlan) {
        for (const meal of n.mealPlan) {
          doc.fontSize(11).fill('#2C2C2C').text(meal.meal, 50);
          for (const opt of (meal.options || [])) {
            doc.fontSize(9).fill('#6B6B6B').text(`  — ${opt}`, 70);
          }
        }
      }

      doc.moveDown(0.5);
      if (n.hydration) doc.fontSize(9).fill('#6B6B6B').text(`Hydration: ${n.hydration}`, 50);
      if (n.supplements) {
        doc.text(`Supplements: ${n.supplements.join(', ')}`, 50);
      }
    }

    const bottom = doc.page.height - 40;
    doc.fontSize(8).fill('#6B6B6B')
      .text('fitnessbymaddy.com | Generated for personal use only', 50, bottom);

    doc.end();
  });
}
