const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { isHinglish, maskPhone } = require('./_lib/market');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in', 'crash diet'
];

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
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

    const { data: leadData } = client.lead_id
      ? await db.from('leads').select('*').eq('id', client.lead_id).single()
      : { data: null };

    const prompt = buildPrompt(client, leadData, recentCheckins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('Claude API error:', errText);
      return res.status(502).json({ error: 'Claude API failed' });
    }

    const claudeData = await claudeRes.json();
    const rawContent = claudeData.content?.[0]?.text || '';

    const safetyCheck = SAFETY_FLAGS.some(flag =>
      rawContent.toLowerCase().includes(flag)
    );
    if (safetyCheck) {
      await notifyMaddy(
        'Program generation flagged for safety review',
        `Client: ${maskPhone(client.phone)} | Week ${week_no}\nReason: Content contains potentially unsafe recommendations`
      );
      return res.status(200).json({
        success: false,
        reason: 'Flagged for safety review'
      });
    }

    let programData;
    try {
      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) ||
                        rawContent.match(/\{[\s\S]*"workout_plan"[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawContent;
      programData = JSON.parse(jsonStr);
    } catch {
      programData = {
        workout_plan: { raw: rawContent },
        nutrition_plan: {},
        notes: 'Auto-parsed from Claude response'
      };
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);
    const pdfPath = `${client_id}/week_${week_no}.pdf`;

    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program } = await db.from('programs').upsert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || {},
      nutrition_plan: programData.nutrition_plan || {},
      notes: programData.notes || null,
      generated_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' }).select().single();

    const market = leadData?.market || 'GLOBAL';
    const templateName = isHinglish(market) ? 'weekly_program' : 'weekly_program_en';
    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      `Week ${week_no}`,
      pdfUrl
    ], client.name);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, lead, checkins, weekNo) {
  const profile = lead?.intake_data || {};
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of 12
- Age: ${profile.age || 'unknown'}
- Gender: ${profile.gender || 'unknown'}
- Goal: ${profile.goal || 'general fitness'}
- Injuries/limitations: ${profile.injuries || 'none reported'}
- Diet preference: ${profile.diet_preference || 'flexible'}
- Experience: ${profile.experience || 'intermediate'}
- Schedule: ${profile.schedule || '5 days/week'}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'not reported'}
- Waist: ${lastCheckin.waist || 'not reported'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'none'}
- Focus: ${lastCheckin.next_week_focus || 'none set'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} → ${lastCheckin?.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10` : ''}

INSTRUCTIONS:
1. Create a progressive, evidence-based program for this specific week
2. Include both workout and nutrition plans
3. Adjust intensity based on compliance and energy levels
4. Address any reported issues
5. Keep calorie recommendations reasonable (never below 1200 for women, 1500 for men)
6. No banned substances or extreme protocols

Respond in valid JSON with this structure:
\`\`\`json
{
  "workout_plan": {
    "summary": "Brief overview",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "exercise", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "description",
    "rest_days": "description"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 70,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "description" }
    ],
    "hydration": "description",
    "supplements": "description"
  },
  "notes": "Coaching note for the week"
}
\`\`\``;
}

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(3);
    doc.fillColor('#2C2C2C');

    const workout = programData.workout_plan || {};
    doc.fontSize(18).fillColor('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (workout.summary) {
      doc.fontSize(11).fillColor('#6B6B6B').text(workout.summary, 50);
      doc.moveDown(0.5);
    }

    if (workout.days && Array.isArray(workout.days)) {
      for (const day of workout.days) {
        doc.moveDown(0.3);
        doc.fontSize(13).fillColor('#2C2C2C').text(`${day.day} — ${day.focus || ''}`, 50);
        doc.moveDown(0.2);

        if (day.exercises && Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            const line = `  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`;
            doc.fontSize(10).fillColor('#6B6B6B').text(line, 60);
            if (ex.notes) {
              doc.fontSize(9).fillColor('#999').text(`    ${ex.notes}`, 70);
            }
          }
        }
      }
    } else if (workout.raw) {
      doc.fontSize(10).fillColor('#6B6B6B').text(workout.raw, 50, doc.y, { width: 500 });
    }

    if (doc.y > 650) doc.addPage();
    doc.moveDown(1.5);

    const nutrition = programData.nutrition_plan || {};
    doc.fontSize(18).fillColor('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    if (nutrition.calories) {
      doc.fontSize(11).fillColor('#2C2C2C')
        .text(`Daily Targets: ${nutrition.calories} kcal | P: ${nutrition.protein_g || '—'}g | C: ${nutrition.carbs_g || '—'}g | F: ${nutrition.fats_g || '—'}g`, 50);
      doc.moveDown(0.5);
    }

    if (nutrition.meal_framework && Array.isArray(nutrition.meal_framework)) {
      for (const meal of nutrition.meal_framework) {
        doc.fontSize(11).fillColor('#2C2C2C').text(`${meal.meal}:`, 50);
        doc.fontSize(10).fillColor('#6B6B6B').text(`  ${meal.suggestion}`, 60);
      }
    }

    if (nutrition.hydration) {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#6B6B6B').text(`Hydration: ${nutrition.hydration}`, 50);
    }

    if (programData.notes) {
      doc.moveDown(1);
      doc.fontSize(14).fillColor('#B8965A').text('COACH\'S NOTE', 50);
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('#2C2C2C').text(programData.notes, 50, doc.y, { width: 500 });
    }

    doc.moveDown(2);
    const bottomY = doc.page.height - 40;
    doc.fontSize(8).fillColor('#C8B89A')
      .text('Fitness by Maddy | fitnessbymaddy.com | Confidential — for personal use only', 50, bottomY, { align: 'center' });

    doc.end();
  });
}
