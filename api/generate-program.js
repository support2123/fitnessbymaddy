const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// Flow E — Generate weekly program for 12-week clients
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  try {
    // Fetch client profile
    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Fetch last 2 check-ins for context
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Fetch intake form data from messages
    const { data: intakeMsgs } = await supabase
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .limit(1);

    let intakeData = {};
    if (intakeMsgs?.[0]?.body) {
      try { intakeData = JSON.parse(intakeMsgs[0].body); } catch {}
    }

    // Build prompt for Claude
    const prompt = buildProgramPrompt(client, checkins || [], intakeData, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0]?.text || '';

    // Parse the JSON response
    let programData;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      await notifyMaddy('Program Gen Failed', `Client ${client_id} Week ${week_no} — parse error`);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    // Safety check — flag risky content
    if (hasSafetyIssues(programData)) {
      await notifyMaddy('Program Safety Flag',
        `Client ${client_id} Week ${week_no} — review needed before sending`);
      // Still save but don't auto-send
      await supabase.from('programs').upsert({
        client_id, week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'FLAGGED: Requires Maddy review before sending'
      }, { onConflict: 'client_id,week_no' });
      return res.status(200).json({ ok: true, flagged: true });
    }

    // Generate branded PDF
    const pdfBuffer = await generatePDF(client, programData, week_no);

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf', upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    // Get public URL for the PDF
    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || '';

    // Save to programs table (audit trail)
    await supabase.from('programs').upsert({
      client_id, week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      pdf_url: pdfUrl,
      notes: programData.notes || null
    }, { onConflict: 'client_id,week_no' });

    // Send via WhatsApp
    const contextNote = programData.notes || `Week ${week_no} program is ready!`;
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there', String(week_no), contextNote
    ], pdfUrl);

    // Update whatsapp_sent_at
    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    await notifyMaddy('Program Gen Error', `Client ${client_id} Week ${week_no}: ${err.message}`);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function buildProgramPrompt(client, checkins, intake, weekNo) {
  return `You are "Program Architect" — a certified fitness coach assistant for FitnessByMaddy.

Generate a weekly training and nutrition plan for this client.

## Client Profile
- Name: ${client.name || 'Client'}
- Program: 12-Week Flagship
- Current Week: ${weekNo} of 12
- Goal: ${intake.goal || 'body recomposition'}
- Experience: ${intake.experience || 'intermediate'}
- Injuries/Conditions: ${intake.injuries || 'none reported'}
- Diet Preference: ${intake.diet_pref || 'flexible'}
- Schedule: ${intake.schedule || '5 days/week'}
- Medical: ${intake.medical_conditions || 'none'}

## Recent Check-in Data
${checkins.length > 0 ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n') : 'No previous check-ins (this is Week 1)'}

## Rules
- Be evidence-based. No bro science.
- Never recommend less than 1200 kcal/day for women or 1500 for men.
- Never recommend banned substances or extreme protocols.
- Adjust intensity based on compliance and energy scores.
- If compliance < 5, simplify the plan.
- If energy < 4, reduce volume and add recovery days.

## Output Format
Return ONLY valid JSON with this structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": "3x per week, 20 min moderate intensity",
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 73,
    "meal_timing": "4 meals, evenly spaced",
    "hydration": "3-4L water daily",
    "supplements": ["creatine 5g", "vitamin D 2000IU"],
    "sample_meals": [
      { "meal": "Breakfast", "options": ["Oats + whey + banana", "Eggs + toast + avocado"] }
    ]
  },
  "notes": "One-liner context note for WhatsApp delivery"
}
\`\`\``;
}

function hasSafetyIssues(data) {
  const json = JSON.stringify(data).toLowerCase();
  const redFlags = [
    'dnp', 'clenbuterol', 'steroid', 'sarm', 'hgh injection',
    'very low calorie', 'vlcd', 'psmf'
  ];
  if (redFlags.some(f => json.includes(f))) return true;
  const cals = data?.nutrition_plan?.calories;
  if (cals && cals < 1200) return true;
  return false;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const BLACK = '#1a1a1a';
    const GOLD = '#B8965A';
    const GREY = '#6B6B6B';

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill(BLACK);
    doc.fontSize(28).fillColor(GOLD)
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 4 });
    doc.fontSize(12).fillColor('#ffffff')
      .text(`WEEK ${weekNo} PROGRAM — ${(client.name || 'CLIENT').toUpperCase()}`, 50, 75, { characterSpacing: 2 });

    let y = 150;

    // Workout Plan
    doc.fontSize(18).fillColor(GOLD).text('WORKOUT PLAN', 50, y);
    y += 30;

    const workout = programData.workout_plan;
    if (workout?.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).fillColor(BLACK).text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fillColor(GREY)
              .text(`  ${ex.name}: ${ex.sets} x ${ex.reps} (Rest: ${ex.rest})${ex.notes ? ' — ' + ex.notes : ''}`, 50, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    if (workout?.cardio) {
      doc.fontSize(11).fillColor(BLACK).text(`Cardio: ${workout.cardio}`, 50, y);
      y += 25;
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    doc.fontSize(18).fillColor(GOLD).text('NUTRITION PLAN', 50, y);
    y += 30;

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      doc.fontSize(11).fillColor(BLACK);
      doc.text(`Calories: ${nutrition.calories} kcal/day`, 50, y); y += 18;
      doc.text(`Protein: ${nutrition.protein_g}g | Carbs: ${nutrition.carbs_g}g | Fat: ${nutrition.fat_g}g`, 50, y); y += 18;
      doc.text(`Meal Timing: ${nutrition.meal_timing || 'N/A'}`, 50, y); y += 18;
      doc.text(`Hydration: ${nutrition.hydration || '3-4L water'}`, 50, y); y += 25;

      if (nutrition.sample_meals?.length) {
        doc.fontSize(13).fillColor(BLACK).text('Sample Meals', 50, y); y += 20;
        for (const meal of nutrition.sample_meals) {
          doc.fontSize(10).fillColor(GREY);
          doc.text(`${meal.meal}: ${(meal.options || []).join(' | ')}`, 50, y); y += 16;
        }
      }
    }

    // Footer
    y = doc.page.height - 60;
    doc.rect(0, y - 10, doc.page.width, 70).fill(BLACK);
    doc.fontSize(8).fillColor(GOLD)
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, y + 5, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}
