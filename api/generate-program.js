const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendDocument } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

const UNSAFE_PATTERNS = [
  /below\s*\d{3,4}\s*calories/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /anabolic/i,
  /steroid/i,
  /lose\s*\d{2,}\s*kg\s*(in|within)\s*\d\s*week/i,
  /semaglutide/i,
  /ozempic/i,
];

function isSafeContent(text) {
  return !UNSAFE_PATTERNS.some(p => p.test(text));
}

async function generateWithClaude(clientData, checkinData, weekNo) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a certified fitness program architect working for FitnessByMaddy, an elite online coaching brand. You create weekly workout and nutrition plans for clients.

RULES:
- Plans must be evidence-based and safe
- Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or medications
- Never promise specific weight loss timelines
- Adjust based on check-in data (compliance, energy, issues)
- Include warm-up and cool-down in every workout
- Account for injuries/limitations from client profile
- Output must be valid JSON`;

  const userPrompt = `Generate Week ${weekNo} program for this client.

CLIENT PROFILE:
${JSON.stringify(clientData, null, 2)}

RECENT CHECK-IN DATA:
${JSON.stringify(checkinData, null, 2)}

Return a JSON object with this exact structure:
{
  "workout_plan": {
    "overview": "Brief week overview",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Exercise Name", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
        ],
        "warmup": "5 min...",
        "cooldown": "5 min..."
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meal_framework": [
      { "meal": "Meal 1 - Breakfast", "suggestion": "...", "macros": "..." }
    ],
    "hydration": "...",
    "supplements": "..."
  },
  "coach_note": "Brief motivational/adjustment note for the client"
}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const responseText = message.content[0].text;

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');

  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(programData, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 100).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fill('#FFFFFF').fontSize(12).font('Helvetica')
      .text(`Week ${weekNo} Program — ${clientName || 'Client'}`, 50, 65);

    doc.moveDown(3);

    // Workout Plan
    const wp = programData.workout_plan;
    doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.fill('#6B6B6B').fontSize(11).font('Helvetica')
      .text(wp.overview || '', 50);
    doc.moveDown(0.5);

    if (wp.days) {
      for (const day of wp.days) {
        doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50);

        if (day.warmup) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Warm-up: ${day.warmup}`, 60);
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            const line = `• ${ex.name} — ${ex.sets} x ${ex.reps} (Rest: ${ex.rest})`;
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica').text(line, 60);
            if (ex.notes) {
              doc.fill('#6B6B6B').fontSize(8).text(`  ${ex.notes}`, 70);
            }
          }
        }

        if (day.cooldown) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Cool-down: ${day.cooldown}`, 60);
        }
        doc.moveDown(0.5);
      }
    }

    // Nutrition Plan
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(20).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 20);

    doc.moveDown(2);

    const np = programData.nutrition_plan;
    doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold')
      .text('Daily Targets', 50);
    doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
      .text(`Calories: ${np.daily_calories} kcal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fats: ${np.fats_g}g`, 50);
    doc.moveDown(0.5);

    if (np.meal_framework) {
      for (const meal of np.meal_framework) {
        doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold')
          .text(meal.meal, 50);
        doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
          .text(meal.suggestion, 60);
        if (meal.macros) {
          doc.fill('#6B6B6B').fontSize(8).text(meal.macros, 60);
        }
        doc.moveDown(0.3);
      }
    }

    if (np.hydration) {
      doc.moveDown(0.5);
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
        .text(`Hydration: ${np.hydration}`, 50);
    }

    if (np.supplements) {
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
        .text(`Supplements: ${np.supplements}`, 50);
    }

    // Coach Note
    if (programData.coach_note) {
      doc.moveDown(1);
      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold')
        .text('NOTE FROM COACH', 50);
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
        .text(programData.coach_note, 50);
    }

    // Footer
    doc.moveDown(2);
    doc.fill('#6B6B6B').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Fetch client profile
    const { data: client } = await supabase
      .from('clients')
      .select('*, lead_id')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Fetch intake data
    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1);

    // Fetch last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientData = {
      name: client.name,
      program: client.program,
      week: week_no,
      intake: intake?.[0] || {},
      program_started_at: client.program_started_at
    };

    // Generate program via Claude
    const programData = await generateWithClaude(clientData, checkins || [], week_no);

    // Safety check
    const programText = JSON.stringify(programData);
    if (!isSafeContent(programText)) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        trigger_keyword: 'unsafe_program_content',
        message_body: `Week ${week_no} program flagged for unsafe content. Awaiting Maddy review.`
      });

      return res.status(200).json({
        success: false,
        flagged: true,
        message: 'Program flagged for manual review due to safety concerns'
      });
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(programData, client.name, week_no);

    // Upload to Supabase Storage
    const pdfPath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData.publicUrl;

    // Save to programs table (audit trail)
    const { data: program, error: insertError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note || null
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // Send via WhatsApp
    const coachNote = programData.coach_note || `Here's your Week ${week_no} program!`;
    await sendDocument(client.phone, pdfUrl, coachNote);

    // Update whatsapp_sent_at
    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
