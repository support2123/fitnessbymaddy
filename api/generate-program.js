import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import supabase from '../lib/supabase.js';
import { sendDocument } from '../lib/whatsapp.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: leadData } = client.lead_id
      ? await supabase.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const { data: intakeMsg } = await supabase
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = {};
    if (intakeMsg?.body) {
      try { intakeData = JSON.parse(intakeMsg.body); } catch {}
    }

    const prompt = buildPrompt(client, recentCheckins || [], intakeData, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {}, notes: '' };
    }

    if (isRiskyPlan(parsed)) {
      const { escalateToMaddy } = await import('../lib/escalation.js');
      await escalateToMaddy(
        client.phone,
        'Risky program generated — needs review',
        `Week ${week_no}: auto-flagged for extreme values`
      );
      return res.status(200).json({
        success: false,
        reason: 'flagged_for_review',
        message: 'Program flagged for manual review'
      });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData.publicUrl;

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: parsed.workout_plan || {},
        nutrition_plan: parsed.nutrition_plan || {},
        notes: parsed.notes || ''
      })
      .select()
      .single();

    const contextNote = `Week ${week_no} program for ${client.name || 'you'} is ready!`;
    await sendDocument(client.phone, pdfUrl, contextNote);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function buildPrompt(client, checkins, intakeData, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand.

Generate a COMPLETE weekly program (Week ${weekNo}) for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intakeData.goal ? `- Goal: ${intakeData.goal}` : ''}
${intakeData.experience_level ? `- Experience: ${intakeData.experience_level}` : ''}
${intakeData.injuries ? `- Injuries/Limitations: ${intakeData.injuries}` : ''}
${intakeData.diet_preference ? `- Diet Preference: ${intakeData.diet_preference}` : ''}
${intakeData.current_weight ? `- Starting Weight: ${intakeData.current_weight}` : ''}
${intakeData.workout_schedule ? `- Availability: ${intakeData.workout_schedule}` : ''}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
${lastCheckin.next_week_focus ? `- Focus area: ${lastCheckin.next_week_focus}` : ''}` : 'No previous check-in data available.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10` : ''}

RULES:
- Design for progressive overload appropriate to the week number
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or unproven supplements
- Set realistic weekly goals (0.5-1kg fat loss max)
- If injuries mentioned, provide safe alternatives
- Include warm-up and cool-down in every workout

Respond with ONLY valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "weekly_volume": "...",
    "progression_note": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meal_timing": ["..."],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "Brief coach note for the client about this week's focus"
}
\`\`\``;
}

function isRiskyPlan(plan) {
  const nutrition = plan.nutrition_plan || {};
  if (nutrition.daily_calories && nutrition.daily_calories < 1200) return true;

  const notes = JSON.stringify(plan).toLowerCase();
  const banned = ['steroid', 'clenbuterol', 'dnp', 'sarm', 'dinitrophenol', 'ephedra'];
  if (banned.some(b => notes.includes(b))) return true;

  if (notes.includes('10kg') && notes.includes('week')) return true;

  return false;
}

function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595.28, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(10).text('FITNESS BY MADDY', 50, 30, { characterSpacing: 4 });
    doc.fill('#FFFFFF').fontSize(28).text(`WEEK ${weekNo}`, 50, 55);
    doc.fontSize(12).text(`Program: ${client.program.toUpperCase()} | ${client.name || 'Client'}`, 50, 90);

    doc.fill('#2C2C2C');
    let y = 140;

    // Workout plan
    const workout = plan.workout_plan || {};
    if (workout.days) {
      doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50, y);
      y += 30;

      if (workout.progression_note) {
        doc.fontSize(10).fill('#6B6B6B').text(workout.progression_note, 50, y, { width: 495 });
        y += 20;
      }

      for (const day of workout.days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.fontSize(14).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.warmup) {
          doc.fontSize(9).fill('#6B6B6B').text(`Warm-up: ${day.warmup}`, 50, y, { width: 495 });
          y += 14;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            const line = `${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`;
            doc.fontSize(10).fill('#2C2C2C').text(line, 70, y, { width: 475 });
            y += 14;
            if (ex.notes) {
              doc.fontSize(8).fill('#6B6B6B').text(ex.notes, 80, y, { width: 465 });
              y += 12;
            }
          }
        }

        if (day.cooldown) {
          doc.fontSize(9).fill('#6B6B6B').text(`Cool-down: ${day.cooldown}`, 50, y, { width: 495 });
          y += 14;
        }

        y += 16;
      }
    }

    // Nutrition plan
    const nutrition = plan.nutrition_plan || {};
    if (nutrition.daily_calories) {
      if (y > 600) { doc.addPage(); y = 50; }

      doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, y);
      y += 30;

      const macros = `Calories: ${nutrition.daily_calories} kcal  |  Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fat: ${nutrition.fat_g}g`;
      doc.fontSize(11).fill('#2C2C2C').text(macros, 50, y, { width: 495 });
      y += 20;

      if (nutrition.meal_timing) {
        doc.fontSize(10).fill('#6B6B6B').text('Meal Timing:', 50, y);
        y += 14;
        for (const meal of nutrition.meal_timing) {
          doc.text(`  ${meal}`, 60, y, { width: 485 });
          y += 14;
        }
        y += 8;
      }

      if (nutrition.hydration) {
        doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${nutrition.hydration}`, 50, y, { width: 495 });
        y += 16;
      }

      if (nutrition.supplements && nutrition.supplements.length > 0) {
        doc.text(`Supplements: ${nutrition.supplements.join(', ')}`, 50, y, { width: 495 });
        y += 16;
      }
    }

    // Coach notes
    if (plan.notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      doc.fontSize(14).fill('#B8965A').text('COACH NOTES', 50, y);
      y += 22;
      doc.fontSize(11).fill('#2C2C2C').text(plan.notes, 50, y, { width: 495 });
    }

    // Footer
    doc.fontSize(8).fill('#C8B89A').text(
      'FITNESS BY MADDY | fitnessbymaddy.com | This program is personalised — do not share.',
      50, 780, { width: 495, align: 'center' }
    );

    doc.end();
  });
}
