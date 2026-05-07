const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
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
      .from('clients').select('*').eq('id', client_id).single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMsg } = await supabase
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1);

    let intakeData = {};
    if (intakeMsg?.[0]?.body) {
      try { intakeData = JSON.parse(intakeMsg[0].body); } catch {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a program architect for FitnessByMaddy, an elite online fitness coaching brand.
You design weekly workout and nutrition plans that are:
- Science-backed, progressive, and safe
- Tailored to the client's profile, goals, and recent progress
- Never extreme (no sub-1200 cal diets, no banned substances, no unrealistic timelines)
- Practical for the client's schedule and equipment access

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS or HIIT", "duration": "20-30 min" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 73,
    "meals": [
      { "meal": "Breakfast", "example": "4 eggs, 2 toast, avocado", "calories": 550 }
    ],
    "notes": "Focus on protein timing around workouts"
  },
  "weekly_notes": "Brief note about this week's focus and adjustments"
}`;

    const userPrompt = buildPrompt(client, intakeData, checkins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const program = JSON.parse(jsonMatch[0]);

    const flagged = SAFETY_FLAGS.some(flag =>
      rawText.toLowerCase().includes(flag)
    );
    if (flagged) {
      const { createEscalation, notifyMaddy } = require('./_lib/escalation');
      await createEscalation(client.phone, 'unsafe_program_content', rawText.slice(0, 500), client.id);
      await notifyMaddy('Program safety flag', client.phone, `Week ${week_no} program flagged for review`);
      return res.status(200).json({ status: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, program, week_no);

    const filePath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.weekly_notes
    });

    const market = detectMarket(client.phone);
    const msg = isHinglish(market)
      ? `🎯 Week ${week_no} ka program ready hai!\n\n${program.weekly_notes || ''}\n\nPDF: ${pdfUrl}\n\nQuestions ho toh message karo! 💪`
      : `🎯 Your Week ${week_no} program is ready!\n\n${program.weekly_notes || ''}\n\nPDF: ${pdfUrl}\n\nMessage us if you have any questions! 💪`;

    const waResult = await sendWhatsApp(client.phone, msg, null, true);

    if (waResult.success) {
      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('client_id', client_id).eq('week_no', week_no);
    }

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for client:\n`;
  prompt += `- Name: ${client.name || 'Client'}\n`;
  prompt += `- Program: ${client.program}\n`;
  prompt += `- Goal: ${intake.goal || 'General fitness'}\n`;
  prompt += `- Age: ${intake.age || 'Unknown'}\n`;
  prompt += `- Gender: ${intake.gender || 'Unknown'}\n`;
  prompt += `- Experience: ${intake.experience_level || 'Intermediate'}\n`;
  prompt += `- Equipment: ${intake.equipment_access || 'Full gym'}\n`;
  prompt += `- Diet preference: ${intake.diet_preference || 'No restrictions'}\n`;
  prompt += `- Injuries/limitations: ${intake.injuries || 'None reported'}\n`;
  prompt += `- Schedule: ${intake.schedule || '5 days/week'}\n\n`;

  if (checkins && checkins.length > 0) {
    prompt += 'Recent check-ins:\n';
    for (const ci of checkins) {
      prompt += `- Week ${ci.week_no}: weight=${ci.weight || '?'}kg, waist=${ci.waist || '?'}cm, compliance=${ci.compliance_score || '?'}/10, energy=${ci.energy || '?'}/10`;
      if (ci.issues) prompt += `, issues: ${ci.issues}`;
      prompt += '\n';
    }
    prompt += '\n';
  }

  prompt += 'Design a progressive, safe, and effective program for this week. Adjust based on check-in data if available.';
  return prompt;
}

function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 120).fill('#1a1a1a');
    doc.fontSize(28).fill('#B8965A')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 72);
    doc.fontSize(10).fill('#888888')
      .text(`${client.name || 'Client'} | ${client.program?.toUpperCase()}`, 50, 94);

    doc.moveDown(4);

    // Workout Plan
    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    const wp = program.workout_plan;
    if (wp?.days) {
      for (const day of wp.days) {
        doc.fontSize(13).fill('#1a1a1a')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#444444')
              .text(`  • ${ex.name}: ${ex.sets} × ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (wp?.cardio) {
      doc.moveDown(0.5);
      doc.fontSize(11).fill('#1a1a1a').text('Cardio');
      doc.fontSize(10).fill('#444444')
        .text(`  ${wp.cardio.frequency} | ${wp.cardio.type} | ${wp.cardio.duration}`, 60);
    }

    doc.addPage();

    // Nutrition Plan
    doc.rect(0, 0, 595, 60).fill('#1a1a1a');
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, 20);

    doc.moveDown(3);
    const np = program.nutrition_plan;
    if (np) {
      doc.fontSize(12).fill('#1a1a1a')
        .text(`Daily Targets: ${np.calories} kcal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`, 50);
      doc.moveDown();

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).fill('#1a1a1a').text(meal.meal, 50);
          doc.fontSize(10).fill('#444444')
            .text(`  ${meal.example} (~${meal.calories} kcal)`, 60);
          doc.moveDown(0.3);
        }
      }

      if (np.notes) {
        doc.moveDown();
        doc.fontSize(10).fill('#666666').text(`Note: ${np.notes}`, 50);
      }
    }

    // Weekly Notes
    if (program.weekly_notes) {
      doc.moveDown(2);
      doc.fontSize(14).fill('#B8965A').text("THIS WEEK'S FOCUS", 50);
      doc.moveDown(0.5);
      doc.fontSize(10).fill('#444444').text(program.weekly_notes, 50, undefined, { width: 495 });
    }

    // Footer
    doc.fontSize(8).fill('#AAAAAA')
      .text('FitnessByMaddy.com | This program is personalised — do not share.', 50, 770, { align: 'center' });

    doc.end();
  });
}
