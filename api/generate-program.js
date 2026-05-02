const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const supabase = getSupabase();

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

    const systemPrompt = `You are an expert fitness program architect for FitnessByMaddy, an elite online coaching brand. You create personalized weekly workout and nutrition plans.

RULES:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without research backing
- Never set unrealistic timelines (e.g. "lose 10kg in 1 week")
- Adjust based on compliance score and energy levels from check-ins
- Consider injuries and limitations
- Be progressive: increase difficulty gradually
- Output valid JSON only`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
${JSON.stringify(client.intake_data || {}, null, 2)}

Program: ${client.program}
Name: ${client.name}

RECENT CHECK-INS:
${JSON.stringify(checkins || [], null, 2)}

Output a JSON object with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 130,
    "carbs_g": 200,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coaching note for the week"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;
    let programData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('Failed to parse program JSON');
      await escalateToMaddy('Program generation failed - invalid JSON', { phone: client.phone, message: `Week ${week_no}` });
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    if (isSafetyFlagged(programData)) {
      await escalateToMaddy('Program flagged for safety review', { phone: client.phone, message: `Week ${week_no} - extreme values detected` });
      return res.status(200).json({ status: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { data: program, error: insertError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        generated_at: new Date().toISOString(),
        pdf_url: publicUrl?.publicUrl || null,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.notes,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Program insert error:', insertError.message);
    }

    if (client.phone && publicUrl?.publicUrl) {
      await sendWhatsApp(client.phone, 'weekly_program', [
        client.name || 'there',
        week_no.toString(),
        programData.notes || 'New week, new gains!',
      ], publicUrl.publicUrl);

      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program?.id);
    }

    return res.status(200).json({ status: 'generated', program_id: program?.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function isSafetyFlagged(data) {
  if (!data?.nutrition_plan) return false;
  const cal = data.nutrition_plan.calories;
  if (cal && cal < 1200) return true;
  if (cal && cal > 5000) return true;
  const supps = (data.nutrition_plan.supplements || []).join(' ').toLowerCase();
  const banned = ['steroid', 'dnp', 'clenbuterol', 'ephedra', 'sarm'];
  if (banned.some(b => supps.includes(b))) return true;
  return false;
}

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 40);
    doc.fill('#ffffff').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 75);
    doc.fill('#cccccc').fontSize(11)
      .text(`Prepared for: ${client.name || 'Client'}`, 50, 95);

    doc.moveDown(4);
    doc.fill('#1a1a1a').fontSize(20).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    const workout = programData.workout_plan;
    if (workout?.days) {
      for (const day of workout.days) {
        doc.fill('#B8965A').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#333333').fontSize(10).font('Helvetica')
              .text(`  • ${ex.name}: ${ex.sets} x ${ex.reps} (Rest: ${ex.rest})`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (workout?.cardio) {
      doc.moveDown(0.5);
      doc.fill('#1a1a1a').fontSize(12).font('Helvetica-Bold').text('Cardio:', 50);
      doc.fill('#333333').fontSize(10).font('Helvetica')
        .text(`  ${workout.cardio.type} | ${workout.cardio.duration} | ${workout.cardio.frequency}`, 60);
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#1a1a1a');
    doc.fill('#B8965A').fontSize(16).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 20);

    doc.moveDown(3);
    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      doc.fill('#1a1a1a').fontSize(12).font('Helvetica-Bold').text('Daily Targets:', 50);
      doc.fill('#333333').fontSize(10).font('Helvetica')
        .text(`  Calories: ${nutrition.calories} kcal`, 60)
        .text(`  Protein: ${nutrition.protein_g}g | Carbs: ${nutrition.carbs_g}g | Fat: ${nutrition.fat_g}g`, 60);
      doc.moveDown(1);

      if (nutrition.meals) {
        doc.fill('#1a1a1a').fontSize(12).font('Helvetica-Bold').text('Meal Plan:', 50);
        doc.moveDown(0.3);
        for (const meal of nutrition.meals) {
          doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold').text(`  ${meal.meal}`, 60);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill('#333333').fontSize(10).font('Helvetica').text(`    • ${opt}`, 70);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (nutrition.hydration) {
        doc.moveDown(0.5);
        doc.fill('#1a1a1a').fontSize(11).font('Helvetica-Bold').text('Hydration:', 50);
        doc.fill('#333333').fontSize(10).font('Helvetica').text(`  ${nutrition.hydration}`, 60);
      }
    }

    if (programData.notes) {
      doc.moveDown(1.5);
      doc.fill('#1a1a1a').fontSize(12).font('Helvetica-Bold').text('Coach\'s Note:', 50);
      doc.fill('#333333').fontSize(10).font('Helvetica').text(`  ${programData.notes}`, 60);
    }

    doc.moveDown(3);
    doc.fill('#999999').fontSize(8).font('Helvetica')
      .text('© Fitness by Maddy | fitnessbymaddy.com | This program is personalized — do not share.', 50);

    doc.end();
  });
}
