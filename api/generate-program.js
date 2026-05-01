const { supabase } = require('./lib/supabase');
const { sendText } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You design safe, science-backed, progressive weekly workout and nutrition plans.

RULES:
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or steroids
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Always include rest days and deload guidance
- Programs must be progressive and periodized
- Consider any injuries or medical conditions reported

Output format: JSON with two keys — "workout_plan" and "nutrition_plan". Each should be detailed enough to follow without additional guidance.`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Unknown'}
Program: ${client.program}
Started: ${client.program_started_at}

${recentCheckins && recentCheckins.length > 0 ? `Recent check-ins:
${recentCheckins.map(c => `- Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No previous check-ins yet (Week 1).'}

Return a JSON object with:
{
  "workout_plan": { "days": [...], "notes": "..." },
  "nutrition_plan": { "calories": ..., "protein": ..., "carbs": ..., "fats": ..., "meals": [...], "notes": "..." },
  "weekly_focus": "...",
  "context_note": "one-liner for WhatsApp message"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some((flag) => fullText.includes(flag));
    if (flagged) {
      await escalateToMaddy(
        'Safety flag in generated program',
        client.phone,
        `Week ${week_no} program flagged for review`
      );
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.weekly_focus,
    });

    const contextNote = parsed.context_note || `Your Week ${week_no} program is ready!`;
    await sendText(
      client.phone,
      `${contextNote}\n\nYour personalized program PDF: ${pdfUrl}`,
      true
    );

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#D4AF7A').text(client.name || 'Client', 50, 95, { align: 'center' });

    doc.moveDown(3);

    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 495, 1).fill('#E8E3DC');
    doc.moveDown(0.5);

    if (plan.workout_plan?.days) {
      for (const day of plan.workout_plan.days) {
        const dayTitle = typeof day === 'string' ? day : (day.day || day.name || 'Day');
        doc.fontSize(12).fill('#2C2C2C').text(dayTitle, 50);

        if (day.exercises) {
          for (const ex of day.exercises) {
            const exText = typeof ex === 'string' ? ex : `${ex.name || ex} — ${ex.sets || ''}x${ex.reps || ''}`;
            doc.fontSize(10).fill('#6B6B6B').text(`  → ${exText}`, 65);
          }
        }
        doc.moveDown(0.3);
      }
    }

    if (plan.workout_plan?.notes) {
      doc.moveDown(0.5);
      doc.fontSize(10).fill('#6B6B6B').text(plan.workout_plan.notes, 50);
    }

    doc.moveDown(1);

    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 495, 1).fill('#E8E3DC');
    doc.moveDown(0.5);

    const np = plan.nutrition_plan;
    if (np) {
      if (np.calories) doc.fontSize(11).fill('#2C2C2C').text(`Daily Calories: ${np.calories} kcal`, 50);
      if (np.protein) doc.fontSize(10).fill('#6B6B6B').text(`Protein: ${np.protein}g | Carbs: ${np.carbs || '—'}g | Fats: ${np.fats || '—'}g`, 50);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          const mealText = typeof meal === 'string' ? meal : `${meal.name || meal.time || 'Meal'}: ${meal.description || meal.items || ''}`;
          doc.fontSize(10).fill('#2C2C2C').text(`  → ${mealText}`, 65);
        }
      }

      if (np.notes) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill('#6B6B6B').text(np.notes, 50);
      }
    }

    if (plan.weekly_focus) {
      doc.moveDown(1);
      doc.fontSize(18).fill('#B8965A').text('WEEKLY FOCUS', 50);
      doc.moveDown(0.5);
      doc.rect(50, doc.y, 495, 1).fill('#E8E3DC');
      doc.moveDown(0.5);
      doc.fontSize(11).fill('#2C2C2C').text(plan.weekly_focus, 50);
    }

    doc.moveDown(2);
    doc.rect(0, doc.y, doc.page.width, 40).fill('#2C2C2C');
    doc.fontSize(8).fill('#D4AF7A').text('www.fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.y + 15, { align: 'center' });

    doc.end();
  });
}
