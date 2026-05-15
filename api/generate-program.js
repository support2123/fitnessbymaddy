const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone, detectMarket, isHinglish } = require('../lib/whatsapp');
const { jsonResponse, errorResponse } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const RISKY_TERMS = [
  'below 1200 calories', 'below 1000 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'sarms', 'steroids',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function checkRiskyContent(text) {
  const lower = text.toLowerCase();
  return RISKY_TERMS.some(term => lower.includes(term));
}

async function generatePDF(plan, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 100).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A').text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(12).fillColor('#FFFFFF').text(`Week ${weekNo} Program — ${clientName}`, 50, 65);

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    // Workout plan
    doc.fontSize(18).fillColor('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#2C2C2C');

    if (plan.workout_plan && Array.isArray(plan.workout_plan.days)) {
      for (const day of plan.workout_plan.days) {
        doc.moveDown(0.5);
        doc.fontSize(13).fillColor('#2C2C2C').text(day.name || day.day, { underline: true });
        doc.fontSize(10).fillColor('#6B6B6B');
        if (Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            doc.text(`  • ${ex.name} — ${ex.sets}x${ex.reps} ${ex.notes || ''}`, { indent: 20 });
          }
        }
        if (day.notes) {
          doc.fontSize(9).fillColor('#B8965A').text(`  Note: ${day.notes}`, { indent: 20 });
        }
      }
    }

    doc.moveDown(2);

    // Nutrition plan
    doc.fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#2C2C2C');

    if (plan.nutrition_plan) {
      const np = plan.nutrition_plan;
      if (np.calories) doc.text(`Daily Target: ${np.calories} kcal`);
      if (np.macros) doc.text(`Macros: P ${np.macros.protein}g | C ${np.macros.carbs}g | F ${np.macros.fat}g`);
      doc.moveDown(0.5);

      if (Array.isArray(np.meals)) {
        for (const meal of np.meals) {
          doc.fontSize(11).fillColor('#2C2C2C').text(meal.name, { underline: true });
          doc.fontSize(10).fillColor('#6B6B6B');
          if (Array.isArray(meal.options)) {
            for (const opt of meal.options) {
              doc.text(`  • ${opt}`, { indent: 20 });
            }
          }
        }
      }
    }

    // Footer
    doc.moveDown(3);
    if (plan.notes) {
      doc.fontSize(10).fillColor('#B8965A').text(`Coach Notes: ${plan.notes}`);
    }
    doc.fontSize(8).fillColor('#C8B89A').text('This program is personalized for you. Do not share. © Fitness by Maddy', 50, 770, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req) {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return errorResponse('Unauthorized', 401);
  }

  const { client_id, week_no } = await req.json();
  if (!client_id || !week_no) return errorResponse('Missing client_id or week_no');

  const db = getSupabase();

  // Get client
  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return errorResponse('Client not found', 404);

  // Get last 2 check-ins
  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  // Get previous program for continuity
  const { data: prevProgram } = await db
    .from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .eq('week_no', week_no - 1)
    .single();

  // Build Claude prompt
  const systemPrompt = `You are an elite fitness program architect for "Fitness by Maddy", a premium online coaching brand. You design evidence-based, personalized weekly workout and nutrition plans.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, extreme protocols, or unrealistic timelines
- Always include rest days
- Base progressions on the client's compliance and check-in data
- Be specific with exercise selection, sets, reps, and tempo
- Provide practical meal options (Indian-friendly when market is IN)

Output ONLY valid JSON matching this schema:
{
  "workout_plan": {
    "days": [
      { "name": "Day 1 — Upper Body", "day": "Monday", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "notes": "2-0-2 tempo" }
      ], "notes": "" }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "macros": { "protein": 150, "carbs": 200, "fat": 70 },
    "meals": [
      { "name": "Breakfast", "options": ["Option 1", "Option 2"] }
    ]
  },
  "notes": "Focus areas for this week"
}`;

  const userPrompt = `Generate Week ${week_no} program for:
Client: ${client.name || 'Client'}
Program: ${client.program}
Market: ${detectMarket(client.phone)}

${checkins && checkins.length > 0 ? `Recent check-ins:
${checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No previous check-ins (first week).'}

${prevProgram ? `Previous week plan notes: ${prevProgram.notes || 'None'}` : 'No previous program (starting fresh).'}`;

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    // Check for risky content
    if (checkRiskyContent(responseText)) {
      await escalateToMaddy('Risky content in generated program', {
        client_id,
        week_no,
        phone: maskPhone(client.phone)
      });
      return jsonResponse({ success: false, reason: 'flagged_for_review' });
    }

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return errorResponse('Failed to parse program JSON', 500);
    }
    const plan = JSON.parse(jsonMatch[0]);

    // Generate PDF
    const pdfBuffer = await generatePDF(plan, client.name || 'Client', week_no);

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });
    const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);

    // Save to programs table (audit trail)
    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: urlData.publicUrl,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.notes
    });

    // Send via WhatsApp
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const contextNote = hinglish
      ? `Week ${week_no} ka program ready hai! ${plan.notes || ''}`
      : `Your Week ${week_no} program is ready! ${plan.notes || ''}`;

    await sendTemplate(client.phone, 'weekly_program', {
      isClient: true,
      name: client.name || 'there',
      templateParams: [String(week_no), contextNote],
      media: { url: urlData.publicUrl, filename: `Week_${week_no}_Program.pdf` }
    });

    // Update whatsapp_sent_at
    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return jsonResponse({ success: true, pdf_url: urlData.publicUrl });
  } catch (err) {
    console.error(`Program generation failed for ${maskPhone(client.phone)}:`, err.message);
    return errorResponse('Program generation failed', 500);
  }
};
