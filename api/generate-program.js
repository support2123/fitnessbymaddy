const Anthropic = require('@anthropic-ai/sdk');
const { jsPDF } = require('jspdf');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { escalate } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme cut',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase()
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase()
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase()
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified program architect for FitnessByMaddy, an elite online coaching brand. Generate a weekly training and nutrition plan for a client.

RULES:
- Evidence-based programming only (no bro-science)
- Never prescribe banned substances, SARMs, or extreme calorie deficits (<1200 cal for women, <1500 cal for men)
- Progressive overload principles
- Account for reported injuries/issues
- Output valid JSON only

OUTPUT FORMAT:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Push", "exercises": [
        { "name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "..." }
      ]}
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Meal 1", "time": "7:00 AM", "items": ["..."], "macros": "..." }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "weekly_focus": "...",
  "coach_note": "..."
}`;

    const userPrompt = buildUserPrompt(client, recentCheckins, lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalate(client.phone, 'Program generation failed: no valid JSON', content.slice(0, 300));
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.find(f => fullText.includes(f));
    if (flagged) {
      await escalate(client.phone, `Unsafe program content: "${flagged}"`, fullText.slice(0, 500));
      return res.status(200).json({ success: false, flagged: true, reason: flagged });
    }

    const pdfBytes = generatePDF(client, programData, week_no);
    const pdfPath = `clients/${client.id}/week_${week_no}.pdf`;

    await supabase().storage.from('clients').upload(pdfPath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: { publicUrl } } = supabase().storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const { data: program } = await supabase().from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || null,
    }).select().single();

    const market = detectMarket(client.phone);
    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.weekly_focus || 'Stay consistent!',
    ]);

    await supabase().from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildUserPrompt(client, checkins, lastProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
`;

  if (checkins && checkins.length > 0) {
    prompt += '\nRecent check-ins:\n';
    for (const c of checkins) {
      prompt += `  Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  if (lastProgram) {
    prompt += `\nLast week focus: ${lastProgram.notes || 'N/A'}`;
    prompt += `\nCalories last week: ${lastProgram.nutrition_plan?.calories || 'N/A'}`;
  }

  prompt += '\n\nAdjust based on progress. Output JSON only.';
  return prompt;
}

function generatePDF(client, programData, weekNo) {
  const doc = new jsPDF();
  const gold = [184, 150, 90];
  const charcoal = [44, 44, 44];
  const midGrey = [107, 107, 107];
  let y = 20;

  doc.setFillColor(...charcoal);
  doc.rect(0, 0, 210, 45, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.text('FITNESS BY MADDY', 15, 22);
  doc.setFontSize(10);
  doc.setTextColor(...gold);
  doc.text(`WEEK ${weekNo} PROGRAM`, 15, 32);
  doc.setTextColor(200, 200, 200);
  doc.text(`${client.name || 'Client'} | ${client.program?.toUpperCase() || ''}`, 15, 40);
  y = 55;

  doc.setTextColor(...charcoal);
  doc.setFontSize(16);
  doc.text('WORKOUT PLAN', 15, y);
  y += 4;
  doc.setDrawColor(...gold);
  doc.setLineWidth(0.5);
  doc.line(15, y, 80, y);
  y += 10;

  if (programData.workout_plan?.days) {
    for (const day of programData.workout_plan.days) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(11);
      doc.setTextColor(...gold);
      doc.text(`${day.day} — ${day.focus}`, 15, y);
      y += 6;
      doc.setFontSize(9);
      doc.setTextColor(...midGrey);
      if (day.exercises) {
        for (const ex of day.exercises) {
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 15, y);
          y += 5;
        }
      }
      y += 4;
    }
  }

  if (y > 200) { doc.addPage(); y = 20; }
  y += 10;
  doc.setTextColor(...charcoal);
  doc.setFontSize(16);
  doc.text('NUTRITION PLAN', 15, y);
  y += 4;
  doc.line(15, y, 80, y);
  y += 10;

  const np = programData.nutrition_plan;
  if (np) {
    doc.setFontSize(10);
    doc.setTextColor(...charcoal);
    doc.text(`Calories: ${np.calories || '—'}  |  Protein: ${np.protein_g || '—'}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fat: ${np.fat_g || '—'}g`, 15, y);
    y += 10;

    if (np.meals) {
      for (const meal of np.meals) {
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setFontSize(10);
        doc.setTextColor(...gold);
        doc.text(`${meal.meal} (${meal.time || ''})`, 15, y);
        y += 5;
        doc.setFontSize(9);
        doc.setTextColor(...midGrey);
        const items = Array.isArray(meal.items) ? meal.items.join(', ') : String(meal.items || '');
        const lines = doc.splitTextToSize(items, 170);
        doc.text(lines, 20, y);
        y += lines.length * 4 + 4;
      }
    }
  }

  if (programData.coach_note) {
    if (y > 240) { doc.addPage(); y = 20; }
    y += 10;
    doc.setFontSize(10);
    doc.setTextColor(...gold);
    doc.text("COACH'S NOTE", 15, y);
    y += 6;
    doc.setTextColor(...midGrey);
    doc.setFontSize(9);
    const noteLines = doc.splitTextToSize(programData.coach_note, 170);
    doc.text(noteLines, 15, y);
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text('fitnessbymaddy.com | Confidential', 15, 290);
    doc.text(`${i} / ${pageCount}`, 190, 290);
  }

  return Buffer.from(doc.output('arraybuffer'));
}
