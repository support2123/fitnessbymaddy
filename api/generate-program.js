const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendMediaMessage, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .maybeSingle();

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      age: intakeForm?.age,
      gender: intakeForm?.gender,
      goal: intakeForm?.goal,
      injuries: intakeForm?.injuries,
      diet_preference: intakeForm?.diet_preference,
      schedule: intakeForm?.schedule,
      experience_level: intakeForm?.experience_level,
      recent_checkins: recentCheckins || []
    };

    const prompt = buildProgramPrompt(clientProfile);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawOutput = response.content[0].text;

    let programData;
    try {
      const jsonMatch = rawOutput.match(/```json\n?([\s\S]*?)\n?```/) || rawOutput.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawOutput);
    } catch {
      await notifyMaddy(
        'Program generation parse error',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nCould not parse Claude output`
      );
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    if (isFlagged(programData)) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReason: Potentially unsafe content detected — extreme calorie cuts or risky recommendations. Please review before sending.`
      );
      return res.status(200).json({ success: false, flagged: true, message: 'Flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(clientProfile, programData);

    const filePath = `${client.folder_url || `clients/${client_id}`}/week_${week_no}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
      await notifyMaddy(
        'PDF upload failed',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nError: ${uploadError.message}`
      );
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: publicUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { error: programError } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl.publicUrl,
      workout_plan: programData.workout_plan || programData.workouts || {},
      nutrition_plan: programData.nutrition_plan || programData.nutrition || {},
      notes: programData.coach_notes || null
    });

    if (programError) {
      console.error('Program insert error:', programError.message);
    }

    const caption = `Week ${week_no} program for ${client.name || 'you'} is ready! Open the PDF for your full workout + nutrition plan.`;
    await sendMediaMessage(client.phone, publicUrl.publicUrl, caption);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({ success: true, pdf_url: publicUrl.publicUrl });

  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function buildProgramPrompt(profile) {
  const checkinSummary = profile.recent_checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n') || 'No previous check-ins.';

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${profile.name || 'Client'}
- Program: ${profile.program}
- Current week: ${profile.week}
- Age: ${profile.age || 'Unknown'}
- Gender: ${profile.gender || 'Unknown'}
- Goal: ${profile.goal || 'General fitness'}
- Injuries/limitations: ${profile.injuries || 'None reported'}
- Diet preference: ${profile.diet_preference || 'No restrictions'}
- Schedule: ${profile.schedule || 'Flexible'}
- Experience: ${profile.experience_level || 'Intermediate'}

RECENT CHECK-INS:
${checkinSummary}

Generate a complete weekly program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "overview": "Brief weekly overview",
    "days": [
      {
        "day": "Monday",
        "focus": "e.g. Upper Body Push",
        "warmup": "5 min warmup description",
        "exercises": [
          { "name": "Exercise name", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cooldown": "5 min stretch"
      }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "macros": { "protein_g": 150, "carbs_g": 200, "fat_g": 65 },
    "meal_timing": "Brief meal timing guidance",
    "sample_meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": ["Brief supplement suggestions if appropriate"],
    "hydration": "Water intake recommendation"
  },
  "coach_notes": "Personalized note based on their check-in data and progress"
}

RULES:
- Never recommend fewer than 1200 calories for women or 1500 for men
- Never suggest banned substances, extreme fasting, or dangerous protocols
- Account for reported injuries — modify exercises accordingly
- Base progressive overload on their compliance and energy scores
- Keep it practical and sustainable`;
}

function isFlagged(programData) {
  const nutrition = programData.nutrition_plan || programData.nutrition || {};
  const calories = nutrition.daily_calories;
  if (calories && calories < 1100) return true;

  const notes = JSON.stringify(programData).toLowerCase();
  const banned = ['dnp', 'clenbuterol', 'ephedra', 'semaglutide', 'ozempic', 'steroids', 'anabolic'];
  if (banned.some(b => notes.includes(b))) return true;

  return false;
}

function generatePDF(profile, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fill('white').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fill(gold).fontSize(12).font('Helvetica')
      .text(`WEEK ${profile.week} PROGRAM`, 50, 72);
    doc.fill('white').fontSize(10)
      .text(`${profile.name || 'Client'} | ${profile.program?.toUpperCase() || 'CUSTOM'}`, 50, 92);

    doc.moveDown(3);

    const workout = programData.workout_plan || programData.workouts || {};
    if (workout.overview) {
      doc.fill(charcoal).fontSize(14).font('Helvetica-Bold')
        .text('WEEKLY OVERVIEW', 50);
      doc.moveDown(0.3);
      doc.fill('#444').fontSize(10).font('Helvetica')
        .text(workout.overview, 50, undefined, { width: 500 });
      doc.moveDown(1);
    }

    const days = workout.days || [];
    for (const day of days) {
      if (doc.y > 680) doc.addPage();

      doc.rect(50, doc.y, 500, 24).fill(gold);
      doc.fill('white').fontSize(11).font('Helvetica-Bold')
        .text(`${day.day} — ${day.focus || ''}`, 58, doc.y + 6, { width: 484 });
      doc.moveDown(1.2);

      if (day.warmup) {
        doc.fill('#666').fontSize(9).font('Helvetica')
          .text(`Warmup: ${day.warmup}`, 58);
        doc.moveDown(0.4);
      }

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        if (doc.y > 720) doc.addPage();
        doc.fill(charcoal).fontSize(10).font('Helvetica-Bold')
          .text(ex.name, 58, undefined, { continued: true });
        doc.font('Helvetica').fill('#666')
          .text(`  ${ex.sets}x${ex.reps} | Rest: ${ex.rest || '60s'}${ex.notes ? ' | ' + ex.notes : ''}`);
      }
      doc.moveDown(0.8);
    }

    const nutrition = programData.nutrition_plan || programData.nutrition || {};
    if (Object.keys(nutrition).length > 0) {
      if (doc.y > 600) doc.addPage();

      doc.moveDown(1);
      doc.rect(50, doc.y, 500, 24).fill(charcoal);
      doc.fill('white').fontSize(11).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 58, doc.y + 6);
      doc.moveDown(1.2);

      if (nutrition.daily_calories) {
        doc.fill(charcoal).fontSize(10).font('Helvetica-Bold')
          .text(`Daily Target: ${nutrition.daily_calories} calories`, 58);
      }
      if (nutrition.macros) {
        const m = nutrition.macros;
        doc.fill('#666').fontSize(9).font('Helvetica')
          .text(`Protein: ${m.protein_g}g | Carbs: ${m.carbs_g}g | Fat: ${m.fat_g}g`, 58);
      }
      doc.moveDown(0.5);

      if (nutrition.sample_meals) {
        for (const meal of nutrition.sample_meals) {
          if (doc.y > 720) doc.addPage();
          doc.fill(charcoal).fontSize(10).font('Helvetica-Bold')
            .text(meal.meal, 58);
          const options = meal.options || [];
          for (const opt of options) {
            doc.fill('#666').fontSize(9).font('Helvetica')
              .text(`  • ${opt}`, 66);
          }
          doc.moveDown(0.3);
        }
      }

      if (nutrition.hydration) {
        doc.moveDown(0.3);
        doc.fill('#666').fontSize(9).font('Helvetica')
          .text(`Hydration: ${nutrition.hydration}`, 58);
      }
    }

    if (programData.coach_notes) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(1.5);
      doc.rect(50, doc.y, 500, 1).fill(gold);
      doc.moveDown(0.5);
      doc.fill(charcoal).fontSize(10).font('Helvetica-Bold')
        .text("COACH'S NOTE", 58);
      doc.moveDown(0.3);
      doc.fill('#444').fontSize(9).font('Helvetica')
        .text(programData.coach_notes, 58, undefined, { width: 484 });
    }

    doc.moveDown(2);
    doc.fill('#999').fontSize(8).font('Helvetica')
      .text('Generated by FitnessByMaddy | fitnessbymaddy.com', 50, undefined, { align: 'center', width: 500 });

    doc.end();
  });
}
