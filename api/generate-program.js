import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const prompt = buildProgramPrompt(client, recentCheckins || [], prevProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0]?.text || '';

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
      parsed = JSON.parse(jsonMatch[1]);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Invalid program format from AI' });
    }

    if (hasSafetyIssues(parsed)) {
      const { sendTemplate: sendWA } = await import('../lib/whatsapp.js');
      const { escalateToMaddy } = await import('../lib/escalation.js');
      await escalateToMaddy('Program flagged for safety review', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program has potential safety issues`,
      });
      return res.status(200).json({ flagged: true, reason: 'safety_review' });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || '';

    const { error: progErr } = await supabase.from('programs').upsert(
      {
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: parsed.workout_plan || parsed.workout,
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition,
        notes: parsed.coach_note || parsed.notes || '',
      },
      { onConflict: 'client_id,week_no' }
    );

    if (progErr) {
      console.error('Program save error:', progErr.message);
    }

    const sentResult = await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.coach_note || 'Your new program is ready!',
    ], pdfUrl);

    if (sentResult.sent) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({
      success: true,
      program_id: client_id,
      week_no,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function buildProgramPrompt(client, checkins, prevProgram, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are an expert fitness coach creating a personalized weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program} (Week ${weekNo})
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'Not reported'} kg
- Waist: ${lastCheckin.waist || 'Not reported'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
- Focus: ${lastCheckin.next_week_focus || 'General improvement'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10` : ''}

${prevProgram ? `PREVIOUS PROGRAM NOTES: ${prevProgram.notes || 'None'}` : ''}

Generate a complete Week ${weekNo} program. Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "warmup": "5 min dynamic stretching",
        "exercises": [
          {"name": "Exercise Name", "sets": 3, "reps": "8-12", "rest": "60s", "notes": ""},
        ],
        "cooldown": "5 min static stretching"
      }
    ],
    "rest_days": ["Sunday"],
    "weekly_cardio": "3x 20-min LISS or 2x HIIT sessions"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      {"meal": "Breakfast", "options": ["Option 1", "Option 2"]},
      {"meal": "Lunch", "options": ["Option 1", "Option 2"]},
      {"meal": "Dinner", "options": ["Option 1", "Option 2"]},
      {"meal": "Snacks", "options": ["Option 1", "Option 2"]}
    ],
    "hydration": "3-4 liters water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Multivitamin"]
  },
  "coach_note": "A short motivational/guidance note for the client (2-3 sentences max)."
}
\`\`\`

RULES:
- Tailor everything to the client's profile, injuries, and diet preference.
- If compliance was low, simplify the program slightly.
- If energy was low, reduce volume but maintain intensity.
- Progress from previous weeks (add weight, reps, or sets where appropriate).
- NEVER prescribe extreme calorie deficits (below 1200 for women, 1500 for men).
- NEVER recommend banned substances or extreme supplementation.
- NEVER promise specific results or timelines.
- Keep the coach_note warm, encouraging, and professional.`;
}

function hasSafetyIssues(program) {
  const nutrition = program.nutrition_plan || program.nutrition || {};
  const calories = nutrition.calories;

  if (calories && calories < 1200) return true;

  const supplements = nutrition.supplements || [];
  const banned = ['steroid', 'sarm', 'dnp', 'clenbuterol', 'ephedra', 'hgh'];
  for (const supp of supplements) {
    const lower = supp.toLowerCase();
    if (banned.some((b) => lower.includes(b))) return true;
  }

  return false;
}

async function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc
      .font('Helvetica-Bold')
      .fontSize(28)
      .fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(14)
      .fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 70, { align: 'center' });
    doc
      .fontSize(10)
      .fillColor('#D4AF7A')
      .text(`${client.name || 'Client'} | ${client.program || '12wk'}`, 50, 92, { align: 'center' });

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    // Workout Plan
    const workout = program.workout_plan || program.workout || {};
    const days = workout.days || [];

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#B8965A').text('WORKOUT PLAN');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
    doc.moveDown(0.5);

    for (const day of days) {
      if (doc.y > 680) doc.addPage();

      doc.font('Helvetica-Bold').fontSize(13).fillColor('#2C2C2C').text(`${day.day} — ${day.focus}`);
      doc.moveDown(0.3);

      if (day.warmup) {
        doc.font('Helvetica').fontSize(9).fillColor('#6B6B6B').text(`Warmup: ${day.warmup}`);
      }
      doc.moveDown(0.2);

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#2C2C2C')
          .text(`  • ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? `  (${ex.notes})` : ''}`, { indent: 10 });
      }

      if (day.cooldown) {
        doc.moveDown(0.2);
        doc.font('Helvetica').fontSize(9).fillColor('#6B6B6B').text(`Cooldown: ${day.cooldown}`);
      }
      doc.moveDown(0.6);
    }

    if (workout.weekly_cardio) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#B8965A').text(`Cardio: ${workout.weekly_cardio}`);
      doc.moveDown(0.3);
    }
    if (workout.rest_days?.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#6B6B6B').text(`Rest Days: ${workout.rest_days.join(', ')}`);
    }

    // Nutrition Plan
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#B8965A').text('NUTRITION PLAN', 50, 22, { align: 'center' });

    doc.moveDown(2);
    doc.fillColor('#2C2C2C');

    const nutrition = program.nutrition_plan || program.nutrition || {};

    // Macros
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#2C2C2C').text('Daily Targets');
    doc.moveDown(0.3);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#6B6B6B')
      .text(`Calories: ${nutrition.calories || 'TBD'} kcal   |   Protein: ${nutrition.protein_g || '—'}g   |   Carbs: ${nutrition.carbs_g || '—'}g   |   Fat: ${nutrition.fat_g || '—'}g`);
    doc.moveDown(0.8);

    // Meals
    const meals = nutrition.meals || [];
    for (const meal of meals) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#2C2C2C').text(meal.meal);
      doc.moveDown(0.2);
      const options = meal.options || [];
      for (const opt of options) {
        doc.font('Helvetica').fontSize(10).fillColor('#6B6B6B').text(`  • ${opt}`, { indent: 10 });
      }
      doc.moveDown(0.5);
    }

    // Hydration & Supplements
    if (nutrition.hydration) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#B8965A').text(`Hydration: ${nutrition.hydration}`);
    }
    if (nutrition.supplements?.length) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#B8965A').text('Supplements:');
      doc.font('Helvetica').fontSize(10).fillColor('#6B6B6B').text(`  ${nutrition.supplements.join(' • ')}`);
    }

    // Coach Note
    const note = program.coach_note || program.notes;
    if (note) {
      doc.moveDown(1.5);
      doc.rect(50, doc.y, 495, 60).fill('#FAF8F4').stroke('#E8E3DC');
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#B8965A').text('  NOTE FROM COACH MADDY', 60);
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(10).fillColor('#2C2C2C').text(`  ${note}`, 60, undefined, { width: 470 });
    }

    // Footer
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(8).fillColor('#6B6B6B').text('© Fitness by Maddy | fitnessbymaddy.com | For personal use only.', 50, 760, { align: 'center' });

    doc.end();
  });
}
