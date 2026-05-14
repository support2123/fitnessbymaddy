import Anthropic from '@anthropic-ai/sdk';
import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { programLabel, maskPhone, jsonResponse } from '../lib/utils.js';
import PDFDocument from 'pdfkit';

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return jsonResponse(res, 400, { error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return jsonResponse(res, 404, { error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await supabase.from('leads').select('first_msg').eq('id', client.lead_id).maybeSingle()
      : { data: null };

    let intakeData = null;
    if (lead?.first_msg) {
      try { intakeData = JSON.parse(lead.first_msg); } catch {}
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified personal trainer and nutrition coach working for Fitness by Maddy.
You create weekly training and nutrition programs that are:
- Science-based and safe
- Progressive (building on previous weeks)
- Adapted to client feedback and check-in data
- Practical and realistic for the client's lifestyle

SAFETY RULES (NEVER violate):
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned or unapproved supplements
- Never suggest extreme measures (very low calorie diets, excessive cardio, dangerous exercises)
- If a client reports pain or injury, recommend rest and medical consultation
- Always include rest days
- Timelines must be realistic (0.5-1kg fat loss per week max)

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "One paragraph context note for the client"
}`;

    const userPrompt = buildUserPrompt(client, intakeData, recentCheckins, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].text;
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return jsonResponse(res, 500, { error: 'Program generation parse error' });
    }

    if (isSafeProgram(programData) === false) {
      await sendTemplate(MADDY_PHONE, 'escalation_alert', [
        `⚠️ PROGRAM SAFETY FLAG\nClient: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nProgram flagged for review before sending.`,
      ]);
      return jsonResponse(res, 200, { ok: true, flagged: true, reason: 'safety_review' });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const filePath = `${client.phone}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
    });

    await sendTemplate(client.phone, 'weekly_program', [
      `Week ${week_no} program is ready! 💪\n\n${programData.notes}\n\nPDF: ${pdfUrl}`,
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return jsonResponse(res, 200, { ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
}

function buildUserPrompt(client, intakeData, checkins, weekNo) {
  let prompt = `Create Week ${weekNo} program for this client:\n\n`;
  prompt += `Program: ${programLabel(client.program)}\n`;
  prompt += `Name: ${client.name || 'Client'}\n`;

  if (intakeData) {
    prompt += `Age: ${intakeData.age || 'Unknown'}\n`;
    prompt += `Gender: ${intakeData.gender || 'Unknown'}\n`;
    prompt += `Goal: ${intakeData.goal || 'General fitness'}\n`;
    prompt += `Experience: ${intakeData.experience || 'Beginner'}\n`;
    prompt += `Injuries: ${intakeData.injuries || 'None reported'}\n`;
    prompt += `Diet preference: ${intakeData.diet_pref || 'No restrictions'}\n`;
    prompt += `Schedule: ${intakeData.schedule || 'Flexible'}\n`;
    prompt += `Current weight: ${intakeData.current_weight || 'Unknown'}\n`;
    prompt += `Target weight: ${intakeData.target_weight || 'Unknown'}\n`;
    prompt += `Height: ${intakeData.height || 'Unknown'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent check-in data:\n`;
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, `;
      prompt += `compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: "${c.issues}"`;
      if (c.next_week_focus) prompt += `, focus: "${c.next_week_focus}"`;
      prompt += `\n`;
    }
  }

  if (weekNo > 1) {
    prompt += `\nThis is week ${weekNo}, so progressively build on previous weeks. `;
    prompt += `Increase intensity/volume appropriately based on check-in data.\n`;
  }

  return prompt;
}

function isSafeProgram(programData) {
  if (!programData) return false;
  const np = programData.nutrition_plan;
  if (np?.calories && np.calories < 1200) return false;

  const dangerousSupplements = ['dnp', 'clenbuterol', 'ephedra', 'anabolic', 'steroid', 'sarm'];
  if (np?.supplements) {
    for (const s of np.supplements) {
      const lower = s.toLowerCase();
      if (dangerousSupplements.some(d => lower.includes(d))) return false;
    }
  }

  return true;
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(3);

    // Workout plan
    doc.fontSize(18).fillColor('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(0.5);

    if (programData.workout_plan?.days) {
      for (const day of programData.workout_plan.days) {
        doc.fontSize(13).fillColor('#B8965A').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fillColor('#2C2C2C')
              .text(`• ${ex.name}: ${ex.sets} x ${ex.reps} (rest: ${ex.rest})`, 70);
            if (ex.notes) {
              doc.fontSize(9).fillColor('#6B6B6B').text(`  ${ex.notes}`, 80);
            }
          }
        }
        doc.moveDown(0.5);

        if (doc.y > 700) doc.addPage();
      }
    }

    if (programData.workout_plan?.cardio) {
      doc.moveDown(0.5);
      const c = programData.workout_plan.cardio;
      doc.fontSize(11).fillColor('#2C2C2C')
        .text(`Cardio: ${c.type} — ${c.duration}, ${c.frequency}`, 50);
    }

    // Nutrition plan
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 80).fill('#2C2C2C');
    doc.fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN', 50, 30, { align: 'center' });
    doc.moveDown(3);

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(12).fillColor('#2C2C2C');
      doc.text(`Daily Calories: ${np.calories} kcal`, 50);
      doc.text(`Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`, 50);
      doc.moveDown(1);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(12).fillColor('#B8965A').text(meal.meal, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fillColor('#2C2C2C').text(`• ${opt}`, 70);
            }
          }
          doc.moveDown(0.5);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#6B6B6B').text(`Hydration: ${np.hydration}`, 50);
      }
    }

    // Notes
    if (programData.notes) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#2C2C2C').text(programData.notes, 50, doc.y, { width: 495 });
    }

    // Footer
    doc.fontSize(8).fillColor('#6B6B6B')
      .text('© Fitness by Maddy — fitnessbymaddy.com', 50, 770, { align: 'center' });

    doc.end();
  });
}
