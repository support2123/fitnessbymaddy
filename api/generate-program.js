const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const supabase = require('../lib/supabase');
const { sendDocument } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet', 'starvation'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const clientProfile = {
      name: client.name,
      program: client.program,
      age: client.age,
      goal: client.goal,
      injuries: client.injuries,
      diet_pref: client.diet_pref,
      schedule: client.schedule,
      week: week_no
    };

    const checkinSummary = (checkins || []).map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues
    }));

    const prompt = buildProgramPrompt(clientProfile, checkinSummary);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    const lowerContent = content.toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (lowerContent.includes(flag)) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy(
          'Risky program content: ' + flag,
          client.phone,
          'Week ' + week_no + ' program for ' + (client.name || maskPhone(client.phone)) + ' flagged for safety review'
        );
        return res.status(200).json({
          status: 'flagged_for_review',
          reason: 'Content contains: ' + flag
        });
      }
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch (parseErr) {
      parsed = { raw: content };
    }

    const workoutPlan = parsed.workout_plan || parsed.workout || {};
    const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
    const notes = parsed.notes || parsed.coach_notes || '';

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan, notes);

    const fileName = 'week_' + week_no + '.pdf';
    const storagePath = 'clients/' + client.id + '/' + fileName;

    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData ? urlData.publicUrl : '';

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes
    }).select().single();

    if (pdfUrl) {
      const weekNote = notes || ('Week ' + week_no + ' program ready!');
      await sendDocument(client.phone, pdfUrl, weekNote.substring(0, 200));

      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('id', program.id);
    }

    return res.status(200).json({
      status: 'generated',
      program_id: program.id,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

function buildProgramPrompt(profile, checkins) {
  return `You are Maddy's AI program architect for FitnessByMaddy. Generate a personalized weekly fitness program.

CLIENT PROFILE:
- Name: ${profile.name || 'Client'}
- Program: ${profile.program}
- Week: ${profile.week}
- Age: ${profile.age || 'Not specified'}
- Goal: ${profile.goal || 'General fitness'}
- Injuries/Limitations: ${profile.injuries || 'None reported'}
- Diet Preference: ${profile.diet_pref || 'No preference'}
- Schedule: ${profile.schedule || 'Flexible'}

RECENT CHECK-IN DATA:
${checkins.length > 0 ? JSON.stringify(checkins, null, 2) : 'No prior check-ins (Week 1)'}

RULES:
- Never prescribe extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- No banned substances or supplements beyond basic protein/creatine/vitamins
- Set realistic weekly targets (0.5-1kg loss or 0.25-0.5kg muscle gain)
- If injuries are reported, provide modifications
- Warm-up and cool-down are mandatory
- Progressive overload: increase volume/intensity gradually

OUTPUT FORMAT (respond ONLY with this JSON, no other text):
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "warmup": "5 min light cardio + dynamic stretches",
        "exercises": [
          {"name": "Exercise", "sets": 3, "reps": "10-12", "rest": "60s", "notes": ""}
        ],
        "cooldown": "5 min static stretching"
      }
    ],
    "rest_days": ["Sunday"],
    "cardio": {"type": "", "frequency": "", "duration": ""}
  },
  "nutrition_plan": {
    "daily_calories": 0,
    "macros": {"protein_g": 0, "carbs_g": 0, "fat_g": 0},
    "meal_timing": [
      {"meal": "Breakfast", "time": "8:00 AM", "suggestion": ""}
    ],
    "hydration": "2.5-3L water daily",
    "supplements": ["Whey protein post-workout"]
  },
  "notes": "Coach's note for the week"
}
\`\`\``;
}

function generatePDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const CHARCOAL = '#2C2C2C';
    const GOLD = '#B8965A';
    const MID_GREY = '#6B6B6B';

    doc.rect(0, 0, doc.page.width, 120).fill(CHARCOAL);
    doc.fontSize(28).fillColor(GOLD).text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(12).fillColor('#FFFFFF')
      .text('Week ' + weekNo + ' Program | ' + (client.name || 'Client'), 50, 75);
    doc.fontSize(10).fillColor(GOLD)
      .text(client.program ? client.program.toUpperCase().replace('_', ' ') : '', 50, 95);

    let y = 145;

    if (notes) {
      doc.fontSize(10).fillColor(MID_GREY).text(notes, 50, y, { width: 500 });
      y += 30;
    }

    doc.fontSize(18).fillColor(CHARCOAL).text('WORKOUT PLAN', 50, y);
    y += 30;

    const days = workout.days || [];
    for (const day of days) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      doc.rect(50, y, 500, 24).fill(GOLD);
      doc.fontSize(11).fillColor('#FFFFFF')
        .text((day.day || '').toUpperCase() + ' — ' + (day.focus || ''), 60, y + 6);
      y += 32;

      if (day.warmup) {
        doc.fontSize(9).fillColor(MID_GREY).text('Warm-up: ' + day.warmup, 60, y);
        y += 16;
      }

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        if (y > 740) {
          doc.addPage();
          y = 50;
        }
        doc.fontSize(10).fillColor(CHARCOAL)
          .text(ex.name, 60, y, { width: 200 });
        doc.fillColor(MID_GREY)
          .text(ex.sets + ' x ' + ex.reps, 270, y, { width: 80 })
          .text('Rest: ' + (ex.rest || '60s'), 360, y, { width: 80 });
        if (ex.notes) {
          doc.fontSize(8).fillColor(MID_GREY).text(ex.notes, 450, y, { width: 100 });
        }
        y += 18;
      }

      if (day.cooldown) {
        doc.fontSize(9).fillColor(MID_GREY).text('Cool-down: ' + day.cooldown, 60, y);
        y += 16;
      }
      y += 10;
    }

    if (workout.cardio && workout.cardio.type) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fontSize(11).fillColor(GOLD).text('CARDIO', 50, y);
      y += 18;
      doc.fontSize(10).fillColor(CHARCOAL)
        .text(workout.cardio.type + ' | ' + workout.cardio.frequency + ' | ' + workout.cardio.duration, 60, y);
      y += 25;
    }

    if (y > 600) { doc.addPage(); y = 50; }

    doc.fontSize(18).fillColor(CHARCOAL).text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutrition.daily_calories) {
      doc.fontSize(12).fillColor(GOLD).text('Daily Target: ' + nutrition.daily_calories + ' calories', 50, y);
      y += 20;
    }

    if (nutrition.macros) {
      doc.fontSize(10).fillColor(CHARCOAL)
        .text('Protein: ' + (nutrition.macros.protein_g || 0) + 'g  |  ' +
              'Carbs: ' + (nutrition.macros.carbs_g || 0) + 'g  |  ' +
              'Fat: ' + (nutrition.macros.fat_g || 0) + 'g', 60, y);
      y += 22;
    }

    const meals = nutrition.meal_timing || [];
    for (const meal of meals) {
      if (y > 740) { doc.addPage(); y = 50; }
      doc.fontSize(10).fillColor(CHARCOAL).text(meal.meal + ' (' + meal.time + ')', 60, y);
      doc.fontSize(9).fillColor(MID_GREY).text(meal.suggestion || '', 60, y + 14, { width: 480 });
      y += 32;
    }

    if (nutrition.hydration) {
      doc.fontSize(9).fillColor(MID_GREY).text('Hydration: ' + nutrition.hydration, 60, y);
      y += 16;
    }

    if (nutrition.supplements && nutrition.supplements.length > 0) {
      doc.fontSize(9).fillColor(MID_GREY)
        .text('Supplements: ' + nutrition.supplements.join(', '), 60, y);
      y += 16;
    }

    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill(CHARCOAL);
    doc.fontSize(8).fillColor(GOLD)
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 28);
    doc.fillColor('#FFFFFF')
      .text('Generated ' + new Date().toLocaleDateString(), 400, doc.page.height - 28);

    doc.end();
  });
}
