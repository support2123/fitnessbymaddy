const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendText, notifyMaddy } = require('./lib/whatsapp');

const SAFETY_FLAGS = [
  'very low calorie', 'under 800', 'under 1000 calories',
  'starvation', 'banned substance', 'steroid', 'clenbuterol',
  'dnp', 'ephedra', 'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { clientId, weekNo } = req.body;
  if (!clientId || !weekNo) return res.status(400).json({ error: 'clientId and weekNo required' });

  const db = getSupabase();

  try {
    const { data: client } = await db.from('clients').select('*').eq('id', clientId).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', clientId)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();

    const checkinContext = recentCheckins && recentCheckins.length > 0
      ? recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
      : 'No previous check-ins (first week).';

    const prompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Program started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinContext}

Create a complete weekly program with:
1. WORKOUT PLAN: 5-6 days of structured workouts with exercises, sets, reps, rest periods. Include warm-up and cooldown.
2. NUTRITION PLAN: Daily calorie target, macro split (protein/carbs/fat), meal timing, sample meals for each meal slot.
3. NOTES: Key focus areas, motivation, adjustments based on check-in data.

CRITICAL RULES:
- Never prescribe calorie intake under 1200 for women or 1500 for men
- Never recommend any banned or dangerous substances
- Set realistic, evidence-based expectations
- Account for any reported issues or injuries

Return as JSON with this exact structure:
{
  "workout_plan": { "days": [...], "notes": "..." },
  "nutrition_plan": { "calories": N, "protein_g": N, "carbs_g": N, "fat_g": N, "meals": [...], "notes": "..." },
  "weekly_notes": "..."
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
    if (flagged) {
      await notifyMaddy(
        'Program flagged for safety review',
        `Client: ${client.name} (${client.id})\nWeek: ${weekNo}\nReason: Content triggered safety filter`
      );
      return res.status(200).json({ ok: true, status: 'flagged_for_review', clientId, weekNo });
    }

    const pdfBuffer = await generatePDF(client, weekNo, programData);

    const fileName = `clients/${clientId}/week_${weekNo}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) console.error('PDF upload error:', uploadErr.message);

    const { data: urlData } = db.storage.from('programs').getPublicUrl(fileName);
    const pdfUrl = urlData ? urlData.publicUrl : null;

    await db.from('programs').insert({
      client_id: clientId,
      week_no: weekNo,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_notes
    });

    if (pdfUrl) {
      const note = programData.weekly_notes
        ? programData.weekly_notes.substring(0, 200)
        : `Week ${weekNo} program ready!`;
      await sendText(client.phone, `💪 Your Week ${weekNo} program is ready!\n\n${note}\n\nPDF: ${pdfUrl}`);

      await db.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', clientId)
        .eq('week_no', weekNo);
    }

    return res.status(200).json({ ok: true, clientId, weekNo, pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    await notifyMaddy('Program generation failed', `Client: ${clientId}, Week: ${weekNo}, Error: ${err.message}`);
    return res.status(500).json({ error: 'Generation failed', detail: err.message });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 75);
    doc.fontSize(10).fill('#D4AF7A').text(`${client.name || 'Client'} | ${client.program}`, 50, 95);

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.fontSize(10).fill('#2C2C2C');

    const wp = programData.workout_plan;
    if (wp && wp.days) {
      wp.days.forEach(day => {
        doc.fontSize(12).fill('#2C2C2C').text(day.name || day.day || 'Training Day');
        if (day.exercises) {
          day.exercises.forEach(ex => {
            const line = `  ${ex.name || ex.exercise}: ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`;
            doc.fontSize(9).fill('#6B6B6B').text(line);
          });
        }
        if (day.focus) doc.fontSize(9).fill('#6B6B6B').text(`  Focus: ${day.focus}`);
        doc.moveDown(0.3);
      });
    }
    if (wp && wp.notes) {
      doc.moveDown(0.5);
      doc.fontSize(9).fill('#6B6B6B').text(wp.notes);
    }

    doc.addPage();

    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, 20);

    doc.moveDown(2);
    doc.fill('#2C2C2C');

    const np = programData.nutrition_plan;
    if (np) {
      doc.fontSize(11).text(`Daily Calories: ${np.calories || 'TBD'} kcal`);
      doc.text(`Protein: ${np.protein_g || '-'}g | Carbs: ${np.carbs_g || '-'}g | Fat: ${np.fat_g || '-'}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        np.meals.forEach(meal => {
          doc.fontSize(11).fill('#2C2C2C').text(meal.name || meal.time || 'Meal');
          if (meal.options || meal.foods) {
            const items = meal.options || meal.foods;
            items.forEach(item => {
              const txt = typeof item === 'string' ? item : item.name || JSON.stringify(item);
              doc.fontSize(9).fill('#6B6B6B').text(`  • ${txt}`);
            });
          }
          if (meal.description) doc.fontSize(9).fill('#6B6B6B').text(`  ${meal.description}`);
          doc.moveDown(0.3);
        });
      }
      if (np.notes) {
        doc.moveDown(0.5);
        doc.fontSize(9).fill('#6B6B6B').text(np.notes);
      }
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#C8B89A').text('© Fitness by Maddy | fitnessbymaddy.com', { align: 'center' });

    doc.end();
  });
}
