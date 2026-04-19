import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import { getSupabase } from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { maskPhone } from '../lib/mask-phone.js';

const SAFETY_FLAGS = [
  'below 1000 calories', 'below 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .maybeSingle();

    if (existingProgram) {
      return res.status(200).json({ message: 'Program already exists', programId: existingProgram.id });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create personalized weekly workout and nutrition plans.

Rules:
- Base recommendations on science-backed principles
- Never suggest extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Set realistic expectations (0.5-1kg fat loss per week max)
- Account for injuries, conditions, and preferences from client data
- Progressive overload principle for strength training
- Adequate protein (1.6-2.2g/kg bodyweight)

Output format: Return a JSON object with exactly these keys:
{
  "workout_plan": { "days": [...], "notes": "..." },
  "nutrition_plan": { "calories": N, "protein": N, "carbs": N, "fat": N, "meals": [...], "notes": "..." },
  "weekly_focus": "one-liner focus for the week",
  "coach_note": "personalized encouragement note (2-3 sentences)"
}`;

    const checkinSummary = recentCheckins?.length
      ? recentCheckins.map((c) => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues=${c.issues || 'none'}`).join('\n')
      : 'No previous check-ins (first week).';

    const userPrompt = `Create Week ${week_no} program for this client:

Client: ${client.name || 'Client'}
Program: ${client.program} (12-week flagship)
Started: ${client.program_started_at}

Recent check-ins:
${checkinSummary}

Generate a complete workout plan (5-6 days) and nutrition plan for Week ${week_no} of 12.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');

    const plans = JSON.parse(jsonMatch[0]);

    const planStr = JSON.stringify(plans).toLowerCase();
    const flagged = SAFETY_FLAGS.some((flag) => planStr.includes(flag));

    if (flagged) {
      const { sendTemplate: sendEscalation } = await import('../lib/whatsapp.js');
      const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';
      await sendEscalation(MADDY_PHONE, 'escalation_alert', [
        'Safety flag in generated program',
        maskPhone(client.phone),
        `Week ${week_no} program flagged for review`,
      ], true);

      return res.status(200).json({ flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, plans);

    const filePath = `${client.folder_url || `clients/${client.id}`}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) console.error('PDF upload error:', uploadError.message);

    const { data: program, error: dbError } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: filePath,
      workout_plan: plans.workout_plan,
      nutrition_plan: plans.nutrition_plan,
      notes: plans.coach_note || plans.weekly_focus || null,
    }).select().single();

    if (dbError) throw dbError;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'Champion',
      String(week_no),
      plans.weekly_focus || `Week ${week_no} program ready!`,
    ], true);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);

    return res.status(200).json({ success: true, programId: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function generatePDF(client, weekNo, plans) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill('#2C2C2C');
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 25, { width: 495 });
    doc.font('Helvetica').fontSize(10).fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { width: 495 });

    doc.moveDown(3);

    // Client info
    doc.fillColor('#2C2C2C').font('Helvetica-Bold').fontSize(14)
      .text(`${client.name || 'Client'} — Week ${weekNo} of 12`, 50);
    doc.font('Helvetica').fontSize(10).fillColor('#6B6B6B')
      .text(`Program: 12-Week Flagship | Generated: ${new Date().toLocaleDateString('en-IN')}`);

    doc.moveDown(1.5);

    // Divider
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(1).stroke();
    doc.moveDown(1);

    // Weekly Focus
    if (plans.weekly_focus) {
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#B8965A')
        .text('WEEKLY FOCUS');
      doc.font('Helvetica').fontSize(11).fillColor('#2C2C2C')
        .text(plans.weekly_focus);
      doc.moveDown(1);
    }

    // Workout Plan
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#2C2C2C')
      .text('WORKOUT PLAN');
    doc.moveDown(0.5);

    if (plans.workout_plan?.days) {
      for (const day of plans.workout_plan.days) {
        const dayLabel = typeof day === 'string' ? day : (day.day || day.name || 'Day');
        const exercises = day.exercises || day.workout || [];

        doc.font('Helvetica-Bold').fontSize(11).fillColor('#B8965A')
          .text(String(dayLabel).toUpperCase());

        if (Array.isArray(exercises)) {
          for (const ex of exercises) {
            const exText = typeof ex === 'string' ? ex : `${ex.name || ex.exercise || ''} — ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? `(Rest: ${ex.rest})` : ''}`;
            doc.font('Helvetica').fontSize(10).fillColor('#2C2C2C')
              .text(`  •  ${exText}`, { indent: 10 });
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (plans.workout_plan?.notes) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B6B6B')
        .text(plans.workout_plan.notes);
    }

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').lineWidth(0.5).stroke();
    doc.moveDown(1);

    // Nutrition Plan
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#2C2C2C')
      .text('NUTRITION PLAN');
    doc.moveDown(0.5);

    if (plans.nutrition_plan) {
      const np = plans.nutrition_plan;
      if (np.calories) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#B8965A')
          .text('DAILY TARGETS');
        doc.font('Helvetica').fontSize(10).fillColor('#2C2C2C')
          .text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein}g  |  Carbs: ${np.carbs}g  |  Fat: ${np.fat}g`);
        doc.moveDown(0.5);
      }

      if (np.meals && Array.isArray(np.meals)) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#B8965A')
          .text('MEAL SUGGESTIONS');
        for (const meal of np.meals) {
          const mealText = typeof meal === 'string' ? meal : `${meal.name || meal.meal || ''}: ${meal.description || meal.foods || ''}`;
          doc.font('Helvetica').fontSize(10).fillColor('#2C2C2C')
            .text(`  •  ${mealText}`, { indent: 10 });
        }
      }

      if (np.notes) {
        doc.moveDown(0.5);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B6B6B')
          .text(np.notes);
      }
    }

    // Coach note
    if (plans.coach_note) {
      doc.moveDown(1.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').lineWidth(0.5).stroke();
      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#B8965A')
        .text('FROM COACH MADDY');
      doc.font('Helvetica-Oblique').fontSize(11).fillColor('#2C2C2C')
        .text(`"${plans.coach_note}"`);
    }

    // Footer
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(8).fillColor('#C8B89A')
      .text('© Fitness by Maddy | fitnessbymaddy.com | @fitnessbymaddy_', 50, 780, { align: 'center', width: 495 });

    doc.end();
  });
}
