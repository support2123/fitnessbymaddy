const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      age: intake?.age,
      gender: intake?.gender,
      goal: intake?.goal,
      injuries: intake?.injuries,
      medical_conditions: intake?.medical_conditions,
      diet_preference: intake?.diet_preference,
      workout_days: intake?.workout_days,
      equipment_access: intake?.equipment_access,
      experience_level: intake?.experience_level
    };

    const checkinHistory = (recentCheckins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const prompt = buildPrompt(clientProfile, checkinHistory);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;
    let programData;

    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      programData = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch {
      console.error(`Failed to parse program JSON for ${maskPhone(client.phone)}`);
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    if (isSafeProgram(programData) === false) {
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy(
        `Generated program flagged for safety review (Week ${week_no})`,
        client.name,
        client.phone
      );
      return res.status(200).json({ ok: true, action: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;

    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || '';

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || programData.workout,
      nutrition_plan: programData.nutrition_plan || programData.nutrition,
      notes: programData.notes || null
    });

    const note = programData.weekly_note || `Week ${week_no} plan is customised based on your latest check-in.`;
    await sendWhatsApp(client.phone, 'program_delivery', {
      week: String(week_no),
      note,
      name: client.name || 'there',
      _isClient: true,
      _mediaUrl: pdfUrl,
      _filename: `Week_${week_no}_Program.pdf`
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, action: 'program_generated', week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(profile, checkins) {
  return `You are a certified fitness program architect for "Fitness by Maddy", an elite online coaching brand.

Generate a detailed, personalised weekly program in JSON format.

## Client Profile
- Name: ${profile.name || 'Client'}
- Program: ${profile.program}
- Week: ${profile.week} of ${profile.program === '12wk' ? 12 : 6}
- Age: ${profile.age || 'Unknown'}
- Gender: ${profile.gender || 'Unknown'}
- Goal: ${profile.goal || 'General fitness'}
- Injuries/Limitations: ${profile.injuries || 'None reported'}
- Medical Conditions: ${profile.medical_conditions || 'None reported'}
- Diet Preference: ${profile.diet_preference || 'No preference'}
- Available Days: ${profile.workout_days || 5} days/week
- Equipment: ${profile.equipment_access || 'Full gym'}
- Experience: ${profile.experience_level || 'Intermediate'}

## Recent Check-in Data
${checkins.length > 0 ? JSON.stringify(checkins, null, 2) : 'No previous check-ins (first week)'}

## Requirements
1. Create a progressive workout plan appropriate for the current week
2. Include warm-up, main workout, and cool-down for each training day
3. Specify sets, reps, rest periods, and RPE/intensity cues
4. Create a nutrition plan with daily calorie target, macro split, and sample meals
5. Add a short weekly note with focus areas and motivation
6. Respect all injuries and medical conditions — NEVER prescribe exercises that aggravate them
7. Keep calorie recommendations realistic (never below 1200 for women, 1500 for men)
8. Do not recommend any banned substances, extreme fasting, or unrealistic timelines

Return ONLY valid JSON in this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "warmup": ["exercise1", "exercise2"],
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
        ],
        "cooldown": ["stretch1", "stretch2"]
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 165,
    "carbs_g": 220,
    "fat_g": 73,
    "meals": [
      { "meal": "Breakfast", "example": "..." },
      { "meal": "Lunch", "example": "..." },
      { "meal": "Dinner", "example": "..." },
      { "meal": "Snacks", "example": "..." }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Creatine 5g", "Vitamin D3"]
  },
  "weekly_note": "Focus on...",
  "notes": "Any additional coaching notes"
}
\`\`\``;
}

function isSafeProgram(data) {
  if (!data) return false;

  const nutrition = data.nutrition_plan || data.nutrition;
  if (nutrition?.daily_calories) {
    if (nutrition.daily_calories < 1200) return false;
  }

  const text = JSON.stringify(data).toLowerCase();
  const banned = ['dnp', 'clenbuterol', 'ephedra', 'sarm', 'steroid', 'hgh injection', 'water fast'];
  if (banned.some(b => text.includes(b))) return false;

  return true;
}

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(
      `Week ${weekNo} Program — ${client.name || 'Client'}`,
      50, 75, { align: 'center' }
    );

    doc.fill('#2C2C2C');
    let y = 140;

    const workout = programData.workout_plan || programData.workout;
    if (workout?.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(16).fill('#B8965A').text(day.day, 50, y);
        y += 24;

        if (day.warmup?.length) {
          doc.fontSize(10).fill('#6B6B6B').text('WARM-UP: ' + day.warmup.join(', '), 50, y);
          y += 16;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(11).fill('#2C2C2C').text(
              `${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`,
              60, y
            );
            y += 16;
            if (ex.notes) {
              doc.fontSize(9).fill('#6B6B6B').text(`   ${ex.notes}`, 60, y);
              y += 14;
            }
          }
        }

        if (day.cooldown?.length) {
          doc.fontSize(10).fill('#6B6B6B').text('COOL-DOWN: ' + day.cooldown.join(', '), 50, y);
          y += 16;
        }
        y += 12;
      }
    }

    const nutrition = programData.nutrition_plan || programData.nutrition;
    if (nutrition) {
      if (y > 600) { doc.addPage(); y = 50; }

      doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, y);
      y += 28;

      doc.fontSize(12).fill('#2C2C2C').text(
        `Daily Target: ${nutrition.daily_calories || '—'} kcal  |  P: ${nutrition.protein_g || '—'}g  |  C: ${nutrition.carbs_g || '—'}g  |  F: ${nutrition.fat_g || '—'}g`,
        50, y
      );
      y += 24;

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill('#2C2C2C').text(`${meal.meal}: `, 60, y, { continued: true });
          doc.fill('#6B6B6B').text(meal.example || '');
          y += 18;
        }
      }
      y += 12;

      if (nutrition.hydration) {
        doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${nutrition.hydration}`, 60, y);
        y += 16;
      }
    }

    if (programData.weekly_note) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 12;
      doc.fontSize(14).fill('#B8965A').text('WEEKLY NOTE', 50, y);
      y += 22;
      doc.fontSize(11).fill('#2C2C2C').text(programData.weekly_note, 50, y, { width: 500 });
    }

    doc.end();
  });
}
