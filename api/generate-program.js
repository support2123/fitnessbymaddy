const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendMedia } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const UNSAFE_PATTERNS = [
  /below\s*800\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|steroids?|sarms?/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*in\s*(1|one)\s*week/i,
  /extreme\s*cut/i
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      .select('*, leads(*)')
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

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const intakeData = client.leads?.intake_data || {};

    const prompt = buildPrompt(client, intakeData, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const aiOutput = response.content[0].text;

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(aiOutput)) {
        await supabase.from('escalations').insert({
          phone: client.phone,
          trigger_keyword: 'unsafe_program_content',
          message_body: `Week ${week_no} program flagged: ${pattern.toString()}`
        });
        return res.status(422).json({
          error: 'Program flagged for safety review',
          pattern: pattern.toString()
        });
      }
    }

    let parsed;
    try {
      const jsonMatch = aiOutput.match(/```json\s*([\s\S]*?)```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : aiOutput);
    } catch {
      parsed = { raw: aiOutput, workout_plan: {}, nutrition_plan: {} };
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload failed:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: parsed.workout_plan || parsed,
        nutrition_plan: parsed.nutrition_plan || {},
        notes: parsed.coach_notes || null
      })
      .select()
      .single();

    const caption = `Week ${week_no} program ready! ${parsed.coach_notes || 'Let\'s crush it this week.'}`;
    const sendResult = await sendMedia(client.phone, pdfUrl, caption);

    if (sendResult.ok) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl,
      whatsapp_sent: sendResult.ok
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are a certified personal trainer and nutrition coach creating a weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'general fitness'}
- Experience: ${intake.experience_level || 'intermediate'}
- Current weight: ${intake.current_weight || 'unknown'}kg
- Target weight: ${intake.target_weight || 'unknown'}kg
- Injuries/limitations: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_preference || 'no preference'}
- Schedule: ${intake.schedule || 'flexible'}

RECENT CHECK-INS:
${checkinSummary || 'No check-in data yet (first week).'}

RULES:
- Create a progressive, safe program appropriate for the client's level
- Never recommend below 1200 calories for women or 1500 for men
- Never recommend banned substances, extreme measures, or unrealistic timelines
- Include warm-up and cool-down in workouts
- Provide practical, culturally appropriate meal suggestions
- If the client reported issues, adapt the program accordingly

OUTPUT FORMAT (respond with valid JSON only, wrapped in \`\`\`json code block):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min rowing + arm circles",
        "cooldown": "5 min stretching"
      }
    ],
    "weekly_volume": "moderate",
    "progressive_overload_note": ""
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "suggestion": "", "calories": 500 }
    ],
    "hydration": "3L water daily",
    "supplements": ["whey protein", "creatine 5g"]
  },
  "coach_notes": "One sentence motivation + key focus for the week."
}`;
}

async function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fillColor('#B8965A')
       .fontSize(10)
       .text('FITNESS BY MADDY', 50, 30, { characterSpacing: 3 });
    doc.fillColor('#FFFFFF')
       .fontSize(28)
       .text(`Week ${weekNo} Program`, 50, 55);
    doc.fillColor('rgba(255,255,255,0.6)')
       .fontSize(11)
       .text(`${client.name || 'Client'} | ${(client.program || '').replace(/_/g, ' ').toUpperCase()}`, 50, 92);

    doc.moveDown(3);

    if (plan.workout_plan?.days) {
      doc.fillColor('#2C2C2C').fontSize(18).text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      doc.fillColor('#B8965A').rect(50, doc.y, 100, 2).fill();
      doc.moveDown(0.8);

      for (const day of plan.workout_plan.days) {
        doc.fillColor('#2C2C2C').fontSize(13).text(`${day.day} — ${day.focus}`, 50);
        if (day.warmup) {
          doc.fillColor('#6B6B6B').fontSize(9).text(`Warm-up: ${day.warmup}`, 60);
        }
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fillColor('#2C2C2C').fontSize(10)
               .text(`  ${ex.name}`, 60, undefined, { continued: true });
            doc.fillColor('#6B6B6B')
               .text(`  ${ex.sets}x${ex.reps} | Rest: ${ex.rest}`, { continued: false });
            if (ex.notes) {
              doc.fillColor('#B8965A').fontSize(8).text(`    ${ex.notes}`, 70);
            }
          }
        }

        if (day.cooldown) {
          doc.fillColor('#6B6B6B').fontSize(9).text(`Cool-down: ${day.cooldown}`, 60);
        }
        doc.moveDown(0.8);
      }
    }

    if (plan.nutrition_plan) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
      doc.fillColor('#B8965A').fontSize(18).text('NUTRITION PLAN', 50, 20);

      doc.moveDown(2);
      const np = plan.nutrition_plan;
      doc.fillColor('#2C2C2C').fontSize(11);
      doc.text(`Daily Calories: ${np.daily_calories || '-'} kcal`, 50);
      doc.text(`Protein: ${np.protein_g || '-'}g | Carbs: ${np.carbs_g || '-'}g | Fat: ${np.fat_g || '-'}g`);
      doc.text(`Hydration: ${np.hydration || '3L water daily'}`);
      doc.moveDown(0.8);

      if (np.meals) {
        doc.fillColor('#2C2C2C').fontSize(13).text('Meals', 50);
        doc.moveDown(0.3);
        for (const meal of np.meals) {
          doc.fillColor('#2C2C2C').fontSize(10)
             .text(`${meal.meal} (~${meal.calories || '?'} kcal)`, 60);
          doc.fillColor('#6B6B6B').fontSize(9)
             .text(`  ${meal.suggestion}`, 70);
          doc.moveDown(0.3);
        }
      }

      if (np.supplements?.length) {
        doc.moveDown(0.5);
        doc.fillColor('#2C2C2C').fontSize(13).text('Supplements', 50);
        doc.fillColor('#6B6B6B').fontSize(10)
           .text(np.supplements.join(', '), 60);
      }
    }

    if (plan.coach_notes) {
      doc.moveDown(1.5);
      doc.rect(50, doc.y, doc.page.width - 100, 50).fill('#FAF8F4');
      doc.fillColor('#B8965A').fontSize(10)
         .text(`Coach's Note: ${plan.coach_notes}`, 60, doc.y - 40, {
           width: doc.page.width - 120
         });
    }

    doc.end();
  });
}
