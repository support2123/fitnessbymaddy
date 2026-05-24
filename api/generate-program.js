const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendWhatsAppText } = require('../lib/whatsapp');

const UNSAFE_PATTERNS = [
  /under\s*[0-9]{3,4}\s*cal/i,
  /steroid/i, /sarm/i, /clenbuterol/i, /dnp/i, /ephedra/i,
  /crash\s*diet/i, /starvation/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i
];

function isSafeProgram(text) {
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

async function generatePDF(workout, nutrition, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fill('#B8965A')
      .fontSize(10)
      .font('Helvetica')
      .text('FITNESS BY MADDY', 50, 40, { characterSpacing: 4 });

    doc.fill('#FFFFFF')
      .fontSize(32)
      .font('Helvetica-Bold')
      .text(`WEEK ${weekNo}`, 50, 70);

    doc.fill('#B8965A')
      .fontSize(14)
      .font('Helvetica')
      .text(`Program for ${clientName || 'Client'}`, 50, 110);

    doc.moveTo(50, 140).lineTo(545, 140).stroke('#B8965A');

    doc.fill('#B8965A')
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, 160);

    doc.fill('#E0E0E0')
      .fontSize(11)
      .font('Helvetica');

    let y = 190;
    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
        doc.fill('#FFFFFF').fontSize(13).font('Helvetica-Bold').text(day.name || 'Day', 50, y);
        y += 20;
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
            doc.fill('#E0E0E0').fontSize(10).font('Helvetica')
              .text(`${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''}  ${ex.rest || ''}`, 70, y);
            y += 16;
          }
        }
        y += 10;
      }
    } else {
      doc.fill('#E0E0E0').fontSize(11).text(JSON.stringify(workout, null, 2).slice(0, 2000), 50, y, { width: 495 });
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fill('#B8965A')
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 50);

    y = 80;
    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        if (y > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a'); y = 50; }
        doc.fill('#FFFFFF').fontSize(13).font('Helvetica-Bold').text(meal.name || 'Meal', 50, y);
        y += 18;
        doc.fill('#E0E0E0').fontSize(10).font('Helvetica')
          .text(meal.items || meal.description || '', 70, y, { width: 475 });
        y += doc.heightOfString(meal.items || meal.description || '', { width: 475 }) + 10;
      }
      if (nutrition.daily_totals) {
        y += 10;
        doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('Daily Totals', 50, y);
        y += 18;
        doc.fill('#E0E0E0').fontSize(10).font('Helvetica')
          .text(`Calories: ${nutrition.daily_totals.calories || 'N/A'} | Protein: ${nutrition.daily_totals.protein || 'N/A'} | Carbs: ${nutrition.daily_totals.carbs || 'N/A'} | Fats: ${nutrition.daily_totals.fats || 'N/A'}`, 50, y);
      }
    } else {
      doc.fill('#E0E0E0').fontSize(11).text(JSON.stringify(nutrition, null, 2).slice(0, 2000), 50, y, { width: 495 });
    }

    const lastPage = doc.bufferedPageRange();
    doc.fill('#333333').fontSize(8)
      .text('fitnessbymaddy.com | Confidential — for personal use only', 50, 770, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
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

    const { data: intake } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic();
    const checkinSummary = (recentCheckins || []).map(c =>
      `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    ).join('\n');

    const clientProfile = [
      `Name: ${client.name}`,
      `Program: ${client.program}`,
      `Goal: ${intake?.goal || 'general fitness'}`,
      `Age: ${intake?.age || 'unknown'}`,
      `Gender: ${intake?.gender || 'unknown'}`,
      `Current Weight: ${intake?.current_weight || recentCheckins?.[0]?.weight || 'unknown'}`,
      `Target Weight: ${intake?.target_weight || 'not specified'}`,
      `Injuries: ${intake?.injuries || 'none reported'}`,
      `Diet Preference: ${intake?.diet_preference || 'no preference'}`,
      `Days/Week: ${intake?.workout_days_per_week || 5}`,
      `Equipment: ${intake?.equipment_access || 'full gym'}`
    ].join('\n');

    const prompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.

Design Week ${week_no} of a 12-week personalized program for this client.

CLIENT PROFILE:
${clientProfile}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins (this is Week 1)'}

RULES:
- Progressive overload from previous weeks
- Never prescribe fewer than 1200 calories for women or 1500 for men
- No banned substances, extreme diets, or unrealistic promises
- Adjust based on compliance and energy scores
- If injuries exist, provide safe alternatives

Return ONLY valid JSON in this exact format:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 — Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ],
    "notes": "Focus on..."
  },
  "nutrition_plan": {
    "meals": [
      { "name": "Meal 1 — Breakfast", "items": "4 egg whites, 1 whole egg, 1 cup oats..." }
    ],
    "daily_totals": { "calories": "2200", "protein": "180g", "carbs": "220g", "fats": "60g" },
    "notes": "Hydration target: 3L water..."
  },
  "context_note": "One-liner summary for WhatsApp delivery"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content[0].text;

    if (!isSafeProgram(responseText)) {
      const { createEscalation } = require('../lib/escalation');
      await createEscalation({
        phone: client.phone,
        clientId: client.id,
        reason: 'Unsafe content in generated program — halted for Maddy review',
        triggerMessage: `Week ${week_no} program flagged for unsafe content`
      });
      return res.status(200).json({ ok: false, reason: 'flagged_for_review' });
    }

    let parsed;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      return res.status(500).json({ error: 'Failed to parse program JSON from Claude' });
    }

    const pdfBuffer = await generatePDF(
      parsed.workout_plan, parsed.nutrition_plan, client.name, week_no
    );

    const filePath = `clients/${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const { error: programError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: publicUrl?.publicUrl || filePath,
        workout_plan: parsed.workout_plan,
        nutrition_plan: parsed.nutrition_plan,
        notes: parsed.context_note || null
      });

    if (programError) {
      console.error('Program record insert error:', programError.message);
    }

    const contextNote = parsed.context_note || `Your Week ${week_no} program is ready!`;
    await sendWhatsAppText(client.phone, `${contextNote}\n\nYour personalized program PDF has been generated. Check your inbox or download it here.`);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: publicUrl?.publicUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
