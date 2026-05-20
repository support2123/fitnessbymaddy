import { getSupabase } from './_lib/supabase.js';
import { sendSessionMessage, notifyMaddy, maskPhone } from './_lib/whatsapp.js';
import { getProgramName } from './_lib/market.js';
import PDFDocument from 'pdfkit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const db = getSupabase();

  try {
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    const prompt = buildPrompt(client, recentCheckins || [], prevProgram, week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} ${errBody.slice(0, 200)}`);
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    let parsed;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/) ||
                        responseText.match(/(\{[\s\S]*\})/);
      parsed = JSON.parse(jsonMatch[1]);
    } catch {
      throw new Error('Failed to parse Claude response as JSON');
    }

    const safetyCheck = checkSafety(parsed);
    if (!safetyCheck.safe) {
      await notifyMaddy(
        'Unsafe program generated',
        `Client ${maskPhone(client.phone)} week ${week_no}: ${safetyCheck.reason}`
      );
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: `FLAGGED: ${safetyCheck.reason}`
      });
      return res.status(200).json({ ok: true, flagged: true, reason: safetyCheck.reason });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData.publicUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null,
      whatsapp_sent_at: new Date().toISOString()
    });

    const weekMsg = `Week ${week_no} program is ready! Here's your plan: ${urlData.publicUrl}`;
    const contextNote = parsed.coach_note
      ? `\n\nCoach note: ${parsed.coach_note}`
      : '';
    await sendSessionMessage(client.phone, weekMsg + contextNote);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ ok: true, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
}

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const checkinSummary = checkins.map(c =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  return `You are an expert fitness program architect for FitnessByMaddy.

Generate a Week ${weekNo} program for this client:
- Name: ${client.name}
- Program: ${getProgramName(client.program)}
- Started: ${client.program_started_at}

Recent check-ins:
${checkinSummary || 'No check-ins yet (Week 1)'}

${prevProgram ? `Previous week plan notes: ${prevProgram.notes || 'none'}` : ''}

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "15 min incline walk"
      }
    ],
    "weekly_volume": "16 sets per muscle group"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 75,
    "meal_framework": [
      { "meal": "Breakfast", "time": "8am", "description": "..." }
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "coach_note": "One-liner context about this week's focus"
}

Rules:
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances, no extreme protocols, no unrealistic timelines
- Progressive overload from previous week if data available
- Keep it practical and sustainable`;
}

function checkSafety(plan) {
  if (!plan) return { safe: false, reason: 'Empty plan' };

  const calories = plan.nutrition_plan?.calories;
  if (calories && calories < 1200) {
    return { safe: false, reason: `Calories too low: ${calories}` };
  }

  const supplements = plan.nutrition_plan?.supplements || [];
  const banned = ['steroid', 'sarm', 'dnp', 'clenbuterol', 'ephedra', 'hgh'];
  for (const supp of supplements) {
    const lower = supp.toLowerCase();
    for (const b of banned) {
      if (lower.includes(b)) {
        return { safe: false, reason: `Banned substance: ${supp}` };
      }
    }
  }

  return { safe: true };
}

async function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica')
      .fillColor('#B8965A')
      .text('ELITE ONLINE COACHING', { align: 'center' });
    doc.fillColor('#2C2C2C');
    doc.moveDown(1.5);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
    doc.moveDown(1);

    doc.fontSize(20).font('Helvetica-Bold')
      .text(`Week ${weekNo} Program`);
    doc.fontSize(12).font('Helvetica')
      .text(`Client: ${client.name || 'Client'}`);
    doc.text(`Program: ${getProgramName(client.program)}`);
    doc.moveDown(1.5);

    if (plan.workout_plan?.days) {
      doc.fontSize(16).font('Helvetica-Bold')
        .fillColor('#B8965A').text('WORKOUT PLAN');
      doc.fillColor('#2C2C2C');
      doc.moveDown(0.5);

      for (const day of plan.workout_plan.days) {
        if (doc.y > 700) doc.addPage();

        doc.fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).font('Helvetica')
              .text(`  ${ex.name}: ${ex.sets} x ${ex.reps} (rest ${ex.rest})${ex.notes ? ' — ' + ex.notes : ''}`);
          }
        }
        if (day.cardio) {
          doc.fontSize(10).font('Helvetica')
            .fillColor('#6B6B6B')
            .text(`  Cardio: ${day.cardio}`);
          doc.fillColor('#2C2C2C');
        }
        doc.moveDown(0.5);
      }
    }

    if (plan.nutrition_plan) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold')
        .fillColor('#B8965A').text('NUTRITION PLAN');
      doc.fillColor('#2C2C2C');
      doc.moveDown(0.5);

      const np = plan.nutrition_plan;
      doc.fontSize(11).font('Helvetica-Bold')
        .text(`Daily Targets: ${np.calories} kcal | ${np.protein_g}g protein | ${np.carbs_g}g carbs | ${np.fat_g}g fat`);
      doc.moveDown(0.5);

      if (np.meal_framework) {
        for (const meal of np.meal_framework) {
          doc.fontSize(11).font('Helvetica-Bold')
            .text(`${meal.meal} (${meal.time})`);
          doc.fontSize(10).font('Helvetica')
            .text(`  ${meal.description}`);
          doc.moveDown(0.3);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica')
          .text(`Hydration: ${np.hydration}`);
      }

      if (np.supplements?.length) {
        doc.text(`Supplements: ${np.supplements.join(', ')}`);
      }
    }

    if (plan.coach_note) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E3DC').stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica-BoldOblique')
        .fillColor('#B8965A')
        .text(`Coach's Note: ${plan.coach_note}`);
    }

    doc.end();
  });
}
