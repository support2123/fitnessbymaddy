import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import { supabase } from '../lib/supabase.js';
import { sendMediaTemplate } from '../lib/whatsapp.js';
import { maskPhone } from '../lib/mask.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'below 1200 calories', 'under 1000 calories', 'extreme deficit',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedrine',
  'lose 10 kg in 1 week', 'lose 20 lbs in a week',
  'starvation', 'very low calorie',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some((flag) => lower.includes(flag));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const systemPrompt = `You are the program architect for Fitness by Maddy, an elite online fitness coaching brand.
You design evidence-based, progressive workout and nutrition plans.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Always include warm-up and cool-down in workout plans
- Be progressive: increase volume/intensity gradually based on check-in data
- Tailor to client's program type, injuries, and preferences
- Output MUST be valid JSON with exactly two keys: "workout_plan" and "nutrition_plan"

workout_plan structure: { "days": [{ "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": N, "reps": "...", "rest": "...", "notes": "..." }], "warmup": "...", "cooldown": "..." }] }

nutrition_plan structure: { "daily_calories": N, "protein_g": N, "carbs_g": N, "fats_g": N, "meals": [{ "meal": "Breakfast", "options": ["...", "..."] }], "hydration": "...", "supplements": ["..."] }`;

    const userPrompt = buildUserPrompt(client, week_no, recentCheckins, prevProgram);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    if (hasSafetyIssue(content)) {
      console.error(`SAFETY FLAG: Program for ${maskPhone(client.phone)} week ${week_no} flagged`);
      await supabase.from('programs').insert({
        client_id,
        week_no,
        notes: 'FLAGGED FOR REVIEW — safety concern detected',
        workout_plan: null,
        nutrition_plan: null,
      });
      return res.status(200).json({ status: 'flagged_for_review' });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Invalid program output' });
    }

    const { workout_plan, nutrition_plan } = parsed;

    const pdfBuffer = await generatePDF(client, week_no, workout_plan, nutrition_plan);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload failed:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || null;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan,
      nutrition_plan,
      pdf_url: pdfUrl,
    });

    if (pdfUrl) {
      const result = await sendMediaTemplate(
        client.phone,
        'weekly_program',
        pdfUrl,
        [client.name || 'there', `Week ${week_no}`]
      );

      if (result.ok) {
        await supabase
          .from('programs')
          .update({ whatsapp_sent_at: new Date().toISOString() })
          .eq('client_id', client_id)
          .eq('week_no', week_no);
      }
    }

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ status: 'program_generated', week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function buildUserPrompt(client, weekNo, checkins, prevProgram) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  if (prevProgram) {
    prompt += `\nPrevious week's plan summary: ${JSON.stringify(prevProgram.workout_plan?.days?.map((d) => d.focus) || [])}\n`;
    if (prevProgram.notes) prompt += `Coach notes: ${prevProgram.notes}\n`;
  }

  prompt += `\nReturn ONLY valid JSON with "workout_plan" and "nutrition_plan" keys. No markdown, no explanation.`;
  return prompt;
}

async function generatePDF(client, weekNo, workoutPlan, nutritionPlan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');

    doc.font('Helvetica-Bold')
      .fontSize(28)
      .fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });

    doc.fontSize(14)
      .fillColor('#ffffff')
      .text(`Week ${weekNo} Program`, 50, 75, { align: 'center' });

    doc.fontSize(10)
      .fillColor('#D4AF7A')
      .text(`${client.name || 'Client'} | ${client.program?.toUpperCase()}`, 50, 95, { align: 'center' });

    let y = 140;

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1a1a1a').text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workoutPlan?.days) {
      for (const day of workoutPlan.days) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }

        doc.rect(50, y, doc.page.width - 100, 24).fill('#2C2C2C');
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#B8965A')
          .text(`${day.day} — ${day.focus || ''}`, 60, y + 6);
        y += 30;

        if (day.warmup) {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B6B6B')
            .text(`Warm-up: ${day.warmup}`, 60, y);
          y += 14;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) {
              doc.addPage();
              y = 50;
            }
            doc.font('Helvetica').fontSize(10).fillColor('#2C2C2C')
              .text(`• ${ex.name}`, 60, y);
            doc.font('Helvetica').fontSize(9).fillColor('#6B6B6B')
              .text(`${ex.sets} sets × ${ex.reps} | Rest: ${ex.rest || '60s'}`, 280, y);
            y += 16;
            if (ex.notes) {
              doc.font('Helvetica-Oblique').fontSize(8).fillColor('#999')
                .text(ex.notes, 70, y);
              y += 12;
            }
          }
        }

        if (day.cooldown) {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B6B6B')
            .text(`Cool-down: ${day.cooldown}`, 60, y);
          y += 14;
        }

        y += 10;
      }
    }

    doc.addPage();
    y = 50;

    doc.rect(0, 0, doc.page.width, 60).fill('#1a1a1a');
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#B8965A')
      .text('NUTRITION PLAN', 50, 18, { align: 'center' });
    y = 80;

    if (nutritionPlan) {
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#2C2C2C')
        .text('Daily Targets', 50, y);
      y += 20;

      const targets = [
        `Calories: ${nutritionPlan.daily_calories || '—'} kcal`,
        `Protein: ${nutritionPlan.protein_g || '—'}g`,
        `Carbs: ${nutritionPlan.carbs_g || '—'}g`,
        `Fats: ${nutritionPlan.fats_g || '—'}g`,
      ];

      for (const t of targets) {
        doc.font('Helvetica').fontSize(10).fillColor('#2C2C2C').text(`• ${t}`, 60, y);
        y += 16;
      }

      y += 10;

      if (nutritionPlan.meals) {
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#2C2C2C').text('Meal Plan', 50, y);
        y += 20;

        for (const meal of nutritionPlan.meals) {
          if (y > 700) {
            doc.addPage();
            y = 50;
          }

          doc.rect(50, y, doc.page.width - 100, 20).fill('#F0EAE0');
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#2C2C2C')
            .text(meal.meal, 60, y + 5);
          y += 26;

          if (meal.options) {
            for (const opt of meal.options) {
              doc.font('Helvetica').fontSize(9).fillColor('#6B6B6B').text(`→ ${opt}`, 70, y);
              y += 14;
            }
          }
          y += 6;
        }
      }

      if (nutritionPlan.hydration) {
        y += 10;
        doc.font('Helvetica').fontSize(10).fillColor('#2C2C2C')
          .text(`💧 Hydration: ${nutritionPlan.hydration}`, 50, y);
        y += 20;
      }

      if (nutritionPlan.supplements?.length) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#2C2C2C')
          .text('Supplements:', 50, y);
        y += 16;
        for (const s of nutritionPlan.supplements) {
          doc.font('Helvetica').fontSize(9).fillColor('#6B6B6B').text(`• ${s}`, 60, y);
          y += 14;
        }
      }
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#999')
        .text(
          'Fitness by Maddy | fitnessbymaddy.com | @fitnessbymaddy_',
          50,
          doc.page.height - 30,
          { align: 'center', width: doc.page.width - 100 }
        );
    }

    doc.end();
  });
}
