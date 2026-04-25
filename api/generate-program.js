const { getSupabase } = require('./_lib/supabase');
const { sendDocument, sendText } = require('./_lib/whatsapp');
const { handleCors, programLabel, maskPhone } = require('./_lib/utils');
const { notifyMaddy } = require('./_lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'very low calorie', 'vlcd', 'under 1000 calories', 'under 800',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'crash diet', 'extreme fasting',
  'water fast for', 'starvation'
];

function checkSafety(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

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

    if (!client) return res.status(404).json({ error: 'client not found' });

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
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness coach creating a weekly training and nutrition program.
Output ONLY valid JSON with two keys: "workout_plan" and "nutrition_plan".

workout_plan structure:
{
  "days": [
    { "day": "Monday", "focus": "Upper Body", "exercises": [
      { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
    ]}
  ],
  "cardio": { "frequency": "3x/week", "type": "LISS or HIIT", "duration": "20-30min" },
  "notes": "Brief coaching note"
}

nutrition_plan structure:
{
  "calories": 2000,
  "protein_g": 150,
  "carbs_g": 200,
  "fat_g": 67,
  "meals": [
    { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
  ],
  "supplements": ["Whey protein", "Creatine 5g"],
  "hydration": "3-4L water daily",
  "notes": "Brief nutrition note"
}

Rules:
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned substances or extreme approaches
- Be warm and encouraging in notes, use the client's name
- Adjust based on check-in data: compliance, energy, issues reported
- If client reports pain or injury, recommend rest for that area and suggest medical consultation`;

    const clientContext = `
Client: ${client.name || 'Client'}
Program: ${programLabel(client.program)}
Week: ${week_no}
Age: ${client.age || 'Unknown'}
Goal: ${client.goal || 'General fitness'}
Injuries/Medical: ${client.injuries || 'None reported'}
Diet Preference: ${client.diet_pref || 'No restrictions'}
Schedule: ${client.schedule || 'Flexible'}

Recent check-ins:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `  Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : '  No previous check-ins'}

${prevProgram ? `Previous week focus: ${prevProgram.notes || 'Standard program'}` : 'First week - create a solid foundation program.'}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: clientContext }]
    });

    const aiText = response.content[0].text;

    const safetyIssue = checkSafety(aiText);
    if (safetyIssue) {
      await notifyMaddy(
        'Program Safety Flag',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nFlag: "${safetyIssue}"\nProgram NOT sent - requires manual review.`
      );
      return res.status(200).json({
        ok: false,
        action: 'safety_flagged',
        flag: safetyIssue
      });
    }

    let parsed;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
    } catch {
      console.error('[GenProgram] Failed to parse AI output');
      return res.status(500).json({ error: 'ai_parse_error' });
    }

    const workoutPlan = parsed.workout_plan || parsed;
    const nutritionPlan = parsed.nutrition_plan || {};

    const pdfBuffer = await generatePDF(client, week_no, workoutPlan, nutritionPlan);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `${client.folder_url || 'clients/' + client.id}/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('[GenProgram] Upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(storagePath);

    const pdfUrl = urlData?.publicUrl || '';

    const { data: program } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes: workoutPlan.notes || nutritionPlan.notes || null
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (pdfUrl) {
      const contextNote = `Week ${week_no} program for ${client.name || 'you'}. ${workoutPlan.notes || 'Stay consistent!'}`;
      await sendDocument(client.phone, pdfUrl, contextNote);

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);
    }

    return res.status(200).json({
      ok: true,
      program_id: program.id,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('[GenProgram] Error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function generatePDF(client, weekNo, workout, nutrition) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill(gold).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75);
    doc.fontSize(10).fill('#AAAAAA')
      .text(`${client.name || 'Client'} | ${new Date().toLocaleDateString('en-GB')}`, 50, 95);

    doc.moveDown(4);

    doc.fontSize(18).fill(gold).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
    doc.moveDown(0.5);

    if (workout.days) {
      for (const day of workout.days) {
        if (doc.y > 680) { doc.addPage(); }

        doc.fontSize(13).fill(charcoal).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus || ''}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#333333').font('Helvetica')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60);
            if (ex.notes) {
              doc.fontSize(9).fill('#888888')
                .text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (workout.cardio) {
      doc.moveDown(0.5);
      doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
        .text('Cardio', 50);
      doc.fontSize(10).fill('#333333').font('Helvetica')
        .text(`  ${workout.cardio.frequency} | ${workout.cardio.type} | ${workout.cardio.duration}`, 60);
    }

    doc.addPage();

    doc.fontSize(18).fill(gold).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(gold);
    doc.moveDown(0.5);

    if (nutrition.calories) {
      doc.fontSize(12).fill(charcoal).font('Helvetica-Bold')
        .text('Daily Targets', 50);
      doc.fontSize(10).fill('#333333').font('Helvetica')
        .text(`  Calories: ${nutrition.calories} kcal`, 60)
        .text(`  Protein: ${nutrition.protein_g || '?'}g  |  Carbs: ${nutrition.carbs_g || '?'}g  |  Fat: ${nutrition.fat_g || '?'}g`, 60);
      doc.moveDown(0.5);
    }

    if (nutrition.meals) {
      doc.fontSize(12).fill(charcoal).font('Helvetica-Bold')
        .text('Meal Plan', 50);
      doc.moveDown(0.3);

      for (const meal of nutrition.meals) {
        doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
          .text(`  ${meal.meal}`, 60);
        if (meal.options) {
          for (const opt of meal.options) {
            doc.fontSize(10).fill('#333333').font('Helvetica')
              .text(`    - ${opt}`, 70);
          }
        }
        doc.moveDown(0.3);
      }
    }

    if (nutrition.supplements) {
      doc.moveDown(0.5);
      doc.fontSize(12).fill(charcoal).font('Helvetica-Bold')
        .text('Supplements', 50);
      for (const s of nutrition.supplements) {
        doc.fontSize(10).fill('#333333').font('Helvetica')
          .text(`  - ${s}`, 60);
      }
    }

    if (nutrition.hydration) {
      doc.moveDown(0.5);
      doc.fontSize(10).fill('#333333').font('Helvetica')
        .text(`Hydration: ${nutrition.hydration}`, 50);
    }

    if (workout.notes || nutrition.notes) {
      doc.moveDown(1);
      doc.fontSize(12).fill(gold).font('Helvetica-Bold')
        .text('Coach Notes', 50);
      doc.fontSize(10).fill('#333333').font('Helvetica')
        .text(workout.notes || nutrition.notes || '', 50, undefined, { width: 495 });
    }

    const bottom = doc.page.height - 40;
    doc.fontSize(8).fill('#AAAAAA').font('Helvetica')
      .text('fitnessbymaddy.com | This program is personalised — do not share.', 50, bottom, { align: 'center' });

    doc.end();
  });
}
