const Anthropic = require('@anthropic-ai/sdk');
const { jsPDF } = require('jspdf');
const { supabase } = require('./lib/supabase');
const { sendDocument } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /very low calorie/i,
  /vlcd/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /anabolic/i,
  /steroid/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*per\s*week/i,
];

function hasSafetyFlags(text) {
  return RISKY_PATTERNS.some((pat) => pat.test(text));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, lead:leads(*)')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intakeData } = await supabase
      .from('intake_data')
      .select('*')
      .eq('lead_id', client.lead_id)
      .maybeSingle();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect — an expert fitness coach creating personalized weekly training and nutrition programs. You are NASM-certified and evidence-based. Never recommend anything unsafe, extreme, or unproven. Output strict JSON only.`;

    const userPrompt = buildPrompt(client, intakeData, recentCheckins, week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].text;

    if (hasSafetyFlags(responseText)) {
      await escalateToMaddy(
        'AI program flagged for safety review',
        client.phone,
        `Week ${week_no} program for ${client.name} contains risky content`
      );
      return res.json({ action: 'flagged_for_review', week_no });
    }

    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Invalid AI response format' });
    }

    const pdfBytes = generatePDF(client, programData, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('coaching')
      .upload(pdfPath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = supabase.storage
      .from('coaching')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData.publicUrl;

    const { error: progErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan || programData.workout,
      nutrition_plan: programData.nutrition_plan || programData.nutrition,
      notes: programData.notes || null,
    });

    if (progErr) {
      console.error('Program record error:', progErr.message);
    }

    const contextNote = programData.notes
      || `Week ${week_no} program ready — ${programData.focus || 'progressive overload continues'}`;

    await sendDocument(client.phone, pdfUrl, contextNote);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const parts = [
    `Create a Week ${weekNo} program for this client.`,
    `\nClient: ${client.name || 'Unknown'}`,
    `Program: ${client.program}`,
  ];

  if (intake) {
    parts.push(`Age: ${intake.age || 'N/A'}, Gender: ${intake.gender || 'N/A'}`);
    parts.push(`Goal: ${intake.goal || 'N/A'}`);
    parts.push(`Injuries: ${intake.injuries || 'None reported'}`);
    parts.push(`Diet preference: ${intake.diet_pref || 'No preference'}`);
    parts.push(`Schedule: ${intake.schedule || 'Flexible'}`);
    parts.push(`Current weight: ${intake.current_weight || 'N/A'} kg`);
    parts.push(`Target weight: ${intake.target_weight || 'N/A'} kg`);
    parts.push(`Experience: ${intake.experience_level || 'N/A'}`);
  }

  if (checkins && checkins.length > 0) {
    parts.push('\nRecent check-ins:');
    for (const c of checkins) {
      parts.push(`  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`);
    }
  }

  parts.push(`\nReturn JSON with this structure:
{
  "focus": "brief 1-line focus for this week",
  "notes": "1-2 sentence context note for WhatsApp delivery",
  "workout_plan": {
    "days": [
      { "day": "Monday", "name": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option A description", "Option B description"] }
    ],
    "supplements": ["Creatine 5g daily", "Vitamin D 2000 IU"]
  }
}`);

  return parts.join('\n');
}

function generatePDF(client, programData, weekNo) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;
  let y = 20;

  doc.setFillColor(44, 44, 44);
  doc.rect(0, 0, pageWidth, 45, 'F');

  doc.setTextColor(184, 150, 90);
  doc.setFontSize(10);
  doc.text('FITNESS BY MADDY', margin, 15);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text(`Week ${weekNo} Program`, margin, 30);

  doc.setFontSize(10);
  doc.setTextColor(200, 200, 200);
  doc.text(`${client.name || 'Client'} | ${client.program?.toUpperCase() || ''}`, margin, 38);

  y = 55;

  if (programData.focus) {
    doc.setFontSize(11);
    doc.setTextColor(184, 150, 90);
    doc.text(`FOCUS: ${programData.focus}`, margin, y);
    y += 10;
  }

  if (programData.workout_plan?.days) {
    doc.setFontSize(14);
    doc.setTextColor(44, 44, 44);
    doc.text('WORKOUT PLAN', margin, y);
    y += 8;

    doc.setDrawColor(184, 150, 90);
    doc.setLineWidth(0.5);
    doc.line(margin, y, margin + contentWidth, y);
    y += 6;

    for (const day of programData.workout_plan.days) {
      if (y > 260) {
        doc.addPage();
        y = 20;
      }

      doc.setFontSize(11);
      doc.setTextColor(44, 44, 44);
      doc.text(`${day.day} — ${day.name}`, margin, y);
      y += 6;

      if (day.exercises) {
        for (const ex of day.exercises) {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.setFontSize(9);
          doc.setTextColor(107, 107, 107);
          const line = `  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  |  ' + ex.notes : ''}`;
          doc.text(line, margin + 4, y);
          y += 5;
        }
      }
      y += 4;
    }
  }

  if (programData.nutrition_plan) {
    if (y > 220) {
      doc.addPage();
      y = 20;
    }

    y += 6;
    doc.setFontSize(14);
    doc.setTextColor(44, 44, 44);
    doc.text('NUTRITION PLAN', margin, y);
    y += 8;

    doc.setDrawColor(184, 150, 90);
    doc.line(margin, y, margin + contentWidth, y);
    y += 8;

    const np = programData.nutrition_plan;
    doc.setFontSize(10);
    doc.setTextColor(44, 44, 44);
    doc.text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, margin, y);
    y += 8;

    if (np.meals) {
      for (const meal of np.meals) {
        if (y > 265) {
          doc.addPage();
          y = 20;
        }
        doc.setFontSize(10);
        doc.setTextColor(44, 44, 44);
        doc.text(meal.meal, margin, y);
        y += 5;

        if (meal.options) {
          for (const opt of meal.options) {
            doc.setFontSize(9);
            doc.setTextColor(107, 107, 107);
            const lines = doc.splitTextToSize(`  • ${opt}`, contentWidth - 10);
            doc.text(lines, margin + 4, y);
            y += lines.length * 4.5;
          }
        }
        y += 3;
      }
    }

    if (np.supplements && np.supplements.length > 0) {
      y += 4;
      doc.setFontSize(10);
      doc.setTextColor(44, 44, 44);
      doc.text('Supplements:', margin, y);
      y += 5;
      for (const sup of np.supplements) {
        doc.setFontSize(9);
        doc.setTextColor(107, 107, 107);
        doc.text(`  • ${sup}`, margin + 4, y);
        y += 5;
      }
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text('fitnessbymaddy.com', margin, 290);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin - 20, 290);
  }

  return Buffer.from(doc.output('arraybuffer'));
}
