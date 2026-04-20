import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';
import supabase from './_lib/supabase.js';
import { sendWhatsApp } from './_lib/whatsapp.js';
import { maskPhone } from './_lib/mask.js';
import { escalateToMaddy } from './_lib/escalation.js';

const SAFETY_FLAGS = [
  'extreme calorie', 'under 1000 calories', 'under 800 calories',
  'banned substance', 'steroid', 'sarm', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for weight loss',
];

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
      .select('*, intake_data')
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

    const programData = await generateWithClaude(client, recentCheckins || [], week_no);

    if (programData.flagged) {
      await escalateToMaddy(
        'Risky program content detected',
        client.phone,
        `Week ${week_no}: ${programData.flagReason}`
      );
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(filePath);

    await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: urlData.publicUrl,
      whatsapp_sent_at: null,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.coachNote,
    });

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.coachNote || 'New program ready!',
      urlData.publicUrl,
    ], true);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error(`Program gen error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
}

async function generateWithClaude(client, checkins, weekNo) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const intake = client.intake_data || {};
  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  const prompt = `You are a program architect for FitnessByMaddy, an elite online fitness coaching brand.

Generate a detailed weekly training and nutrition program for Week ${weekNo} of a 12-week program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: 12-Week Flagship
- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Experience: ${intake.experience_level || 'Intermediate'}
- Injuries/Limitations: ${intake.injuries || 'None reported'}
- Diet Preference: ${intake.diet_preference || 'No preference'}
- Schedule: ${intake.schedule || 'Flexible'}

LAST CHECK-IN (Week ${lastCheckin.week_no || 'N/A'}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}

PREVIOUS CHECK-IN (Week ${prevCheckin.week_no || 'N/A'}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10

Return a JSON object with this exact structure:
{
  "workout": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...for each training day
    ],
    "restDays": ["Sunday"],
    "cardio": { "type": "LISS", "frequency": "3x/week", "duration": "25 min" }
  },
  "nutrition": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fats": 70,
    "mealPlan": [
      { "meal": "Breakfast", "time": "7:00 AM", "options": ["Option 1 description", "Option 2 description"] },
      ...for each meal
    ],
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "coachNote": "One line context note for the client about this week's focus"
}

RULES:
- Never recommend extreme calorie cuts (minimum 1200 cal for women, 1500 for men)
- Never recommend banned substances, steroids, SARMs, DNP, or clenbuterol
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Adjust based on compliance and energy from check-ins
- If compliance is low, simplify. If energy is low, reduce volume.
- Be warm and expert in the coach note. Not bro-sciency.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse Claude response as JSON');

  const parsed = JSON.parse(jsonMatch[0]);

  const fullText = JSON.stringify(parsed).toLowerCase();
  const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));

  if (flagged) {
    const flagReason = SAFETY_FLAGS.filter(f => fullText.includes(f)).join(', ');
    return { ...parsed, flagged: true, flagReason };
  }

  if (parsed.nutrition?.calories && parsed.nutrition.calories < 1200) {
    return { ...parsed, flagged: true, flagReason: `Calories too low: ${parsed.nutrition.calories}` };
  }

  return { ...parsed, flagged: false };
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const CHARCOAL = '#2C2C2C';
    const GOLD = '#B8965A';
    const MID_GREY = '#6B6B6B';

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill(CHARCOAL);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(12).fill(GOLD).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 72);
    doc.fontSize(10).fill('#AAAAAA')
      .text(`${client.name || 'Client'} | 12-Week Flagship`, 50, 92);

    doc.moveDown(3);
    let y = 140;

    // Workout Section
    doc.fontSize(18).fill(GOLD).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (programData.workout?.days) {
      for (const day of programData.workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill(CHARCOAL).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(MID_GREY).font('Helvetica')
              .text(`•  ${ex.name}  —  ${ex.sets} × ${ex.reps}  |  Rest: ${ex.rest}`, 65, y);
            y += 16;
            if (ex.notes) {
              doc.fontSize(9).fill('#999999')
                .text(`   ${ex.notes}`, 75, y);
              y += 14;
            }
          }
        }
        y += 12;
      }
    }

    if (programData.workout?.cardio) {
      if (y > 700) { doc.addPage(); y = 50; }
      const c = programData.workout.cardio;
      doc.fontSize(11).fill(CHARCOAL).font('Helvetica-Bold')
        .text('Cardio', 50, y);
      y += 18;
      doc.fontSize(10).fill(MID_GREY).font('Helvetica')
        .text(`${c.type} — ${c.frequency}, ${c.duration}`, 65, y);
      y += 24;
    }

    // Nutrition Section
    if (y > 600) { doc.addPage(); y = 50; }

    doc.fontSize(18).fill(GOLD).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (programData.nutrition) {
      const n = programData.nutrition;
      doc.fontSize(11).fill(CHARCOAL).font('Helvetica-Bold')
        .text(`Daily Targets: ${n.calories} cal  |  P: ${n.protein}g  |  C: ${n.carbs}g  |  F: ${n.fats}g`, 50, y);
      y += 24;

      if (n.mealPlan) {
        for (const meal of n.mealPlan) {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(CHARCOAL).font('Helvetica-Bold')
            .text(`${meal.meal} (${meal.time})`, 50, y);
          y += 18;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill(MID_GREY).font('Helvetica')
                .text(`•  ${opt}`, 65, y);
              y += 15;
            }
          }
          y += 8;
        }
      }

      if (n.supplements?.length) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(11).fill(CHARCOAL).font('Helvetica-Bold')
          .text('Supplements', 50, y);
        y += 18;
        for (const s of n.supplements) {
          doc.fontSize(10).fill(MID_GREY).font('Helvetica')
            .text(`•  ${s}`, 65, y);
          y += 15;
        }
      }
    }

    // Coach Note
    if (programData.coachNote) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.rect(50, y, doc.page.width - 100, 50).fill('#FAF8F4');
      doc.fontSize(10).fill(GOLD).font('Helvetica-Bold')
        .text('COACH NOTE', 65, y + 10);
      doc.fontSize(10).fill(CHARCOAL).font('Helvetica')
        .text(programData.coachNote, 65, y + 26, { width: doc.page.width - 140 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#CCCCCC').font('Helvetica')
        .text('© Fitness by Maddy — Confidential', 50, doc.page.height - 30);
    }

    doc.end();
  });
}
