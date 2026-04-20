const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_KEYWORDS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function checkSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_KEYWORDS.filter(kw => lower.includes(kw));
}

async function generatePDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(28).font('Helvetica-Bold')
      .fillColor('#B8965A')
      .text('FITNESS BY MADDY', { align: 'center' });

    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica')
      .fillColor('#6B6B6B')
      .text('ELITE ONLINE COACHING', { align: 'center' });

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
    doc.moveDown(1);

    // Client info
    doc.fontSize(18).font('Helvetica-Bold')
      .fillColor('#2C2C2C')
      .text(`Week ${weekNo} Program`);

    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica')
      .fillColor('#6B6B6B')
      .text(`Client: ${client.name || 'Client'} | Program: 12-Week Custom`);

    doc.moveDown(1);

    // Workout Plan
    doc.fontSize(16).font('Helvetica-Bold')
      .fillColor('#B8965A')
      .text('WORKOUT PLAN');
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(12).font('Helvetica-Bold')
          .fillColor('#2C2C2C')
          .text(day.name);
        doc.moveDown(0.2);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).font('Helvetica')
              .fillColor('#6B6B6B')
              .text(`  ${ex.name} — ${ex.sets}x${ex.reps} ${ex.notes || ''}`, { indent: 10 });
          }
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).font('Helvetica').fillColor('#6B6B6B')
        .text(JSON.stringify(workout, null, 2));
    }

    doc.moveDown(1);

    // Nutrition Plan
    doc.fontSize(16).font('Helvetica-Bold')
      .fillColor('#B8965A')
      .text('NUTRITION PLAN');
    doc.moveDown(0.5);

    if (nutrition && nutrition.meals) {
      doc.fontSize(10).font('Helvetica').fillColor('#2C2C2C')
        .text(`Daily Calories: ${nutrition.calories || 'As recommended'} | Protein: ${nutrition.protein || '-'}g | Carbs: ${nutrition.carbs || '-'}g | Fats: ${nutrition.fats || '-'}g`);
      doc.moveDown(0.5);

      for (const meal of nutrition.meals) {
        doc.fontSize(11).font('Helvetica-Bold')
          .fillColor('#2C2C2C')
          .text(meal.name);
        doc.fontSize(10).font('Helvetica')
          .fillColor('#6B6B6B')
          .text(`  ${meal.description}`, { indent: 10 });
        doc.moveDown(0.3);
      }
    } else {
      doc.fontSize(10).font('Helvetica').fillColor('#6B6B6B')
        .text(JSON.stringify(nutrition, null, 2));
    }

    if (notes) {
      doc.moveDown(1);
      doc.fontSize(16).font('Helvetica-Bold')
        .fillColor('#B8965A')
        .text('COACH NOTES');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica')
        .fillColor('#6B6B6B')
        .text(notes);
    }

    // Footer
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).font('Helvetica').fillColor('#C8B89A')
      .text('fitnessbymaddy.com | @fitnessbymaddy_ | This program is confidential and for personal use only.', { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}` && process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Get client data
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get intake data
    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    // Get last 2 check-ins
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Build prompt for Claude
    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      intake: intake ? {
        age: intake.age,
        gender: intake.gender,
        height: intake.height_cm,
        weight: intake.current_weight,
        goalWeight: intake.goal_weight,
        goal: intake.goal,
        injuries: intake.injuries,
        dietPref: intake.diet_preference,
        workoutDays: intake.workout_days_per_week,
        location: intake.workout_location,
        equipment: intake.equipment_available
      } : null,
      recentCheckins: recentCheckins || []
    };

    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are a NASM-certified fitness program architect for FitnessByMaddy. Generate Week ${week_no} of a 12-week custom program.

CLIENT DATA:
${JSON.stringify(clientProfile, null, 2)}

RULES:
- Never recommend extreme calorie deficits (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Account for injuries and medical conditions
- Progressive overload: increase intensity/volume from previous weeks
- If check-in shows low compliance, simplify the plan
- If check-in shows low energy, reduce volume and add recovery
- Include warm-up and cool-down in each session

OUTPUT FORMAT (respond with ONLY valid JSON, no markdown):
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "2min rest" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fats": 65,
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "4 eggs, 2 toast, 1 banana" }
    ]
  },
  "notes": "Focus areas and coaching notes for the week"
}`
      }]
    });

    const responseText = response.content[0].text;

    // Safety check
    const safetyIssues = checkSafety(responseText);
    if (safetyIssues.length > 0) {
      await notifyMaddy(
        `SAFETY FLAG: Program for ${client.name || maskPhone(client.phone)} W${week_no} contains risky content: ${safetyIssues.join(', ')}. Program halted — please review manually.`
      );
      return res.status(200).json({ action: 'flagged', issues: safetyIssues });
    }

    let programData;
    try {
      programData = JSON.parse(responseText);
    } catch {
      // Try extracting JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        programData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse program JSON from Claude response');
      }
    }

    const { workout_plan, nutrition_plan, notes } = programData;

    // Generate PDF
    const pdfBuffer = await generatePDF(client, week_no, workout_plan, nutrition_plan, notes);

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Save to programs table
    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan,
        nutrition_plan,
        notes
      })
      .select()
      .single();

    // Send via WhatsApp
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      notes ? notes.substring(0, 200) : 'Your new program is ready!',
      pdfUrl
    ]);

    // Update whatsapp_sent_at
    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} W${week_no}`);
    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
