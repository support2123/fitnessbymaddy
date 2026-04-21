const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { escalateToMaddy } = require('./_lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const SYSTEM_PROMPT = `You are a program architect for FitnessByMaddy, an elite online fitness coaching brand.
You create personalized weekly workout and nutrition plans based on client data and progress.

Rules:
- Never recommend extreme calorie cuts (below 1200 for women, 1500 for men)
- Never recommend banned substances or supplements with safety concerns
- Never promise unrealistic timelines
- Base recommendations on evidence-based exercise science
- Consider injuries, medical conditions, and experience level
- Apply progressive overload principles
- Adjust based on compliance scores and energy levels from check-ins

Output MUST be valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "type": "LISS Walking", "frequency": "3x/week", "duration": "30 min" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Option A description", "Option B description"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4 litres water daily"
  },
  "notes": "Coach note for the week",
  "focus": "Main focus area for this week"
}`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*, leads!clients_lead_id_fkey(intake_data)')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const intake = client.leads?.intake_data || {};
  const checkinSummary = (checkins && checkins.length > 0)
    ? checkins.map(c =>
      `Week ${c.week_no}: weight=${c.weight || '?'}kg, waist=${c.waist || '?'}cm, compliance=${c.compliance_score || '?'}/10, energy=${c.energy || '?'}/10, issues="${c.issues || 'none'}"`
    ).join('\n')
    : 'No previous check-ins (this is the first week).';

  const userPrompt = `Generate Week ${week_no} program for this client:
Name: ${client.name || 'Client'}
Program: ${client.program}
Age: ${intake.age || 'Unknown'}
Goal: ${intake.goal || 'General fitness'}
Injuries: ${intake.injuries || 'None reported'}
Diet preference: ${intake.diet_pref || 'No restriction'}
Schedule availability: ${intake.schedule || 'Flexible'}
Medical conditions: ${intake.medical_conditions || 'None reported'}
Experience level: ${intake.experience_level || 'Intermediate'}

Recent check-ins:
${checkinSummary}

Create a detailed, personalized program for this week. Return ONLY the JSON object.`;

  let programData;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Program generation failed', detail: e.message });
  }

  if (programData.nutrition_plan?.calories && programData.nutrition_plan.calories < 1200) {
    await escalateToMaddy({
      reason: 'Generated program has dangerously low calories',
      phone: client.phone,
      message: `Week ${week_no}: ${programData.nutrition_plan.calories} kcal — halted`,
      clientName: client.name,
    });
    return res.status(400).json({ error: 'Program flagged for review — calories too low' });
  }

  const pdfBytes = await buildPDF(client, week_no, programData);

  const pdfPath = `${client_id}/week_${week_no}.pdf`;
  await db.storage.from('clients').upload(pdfPath, pdfBytes, {
    contentType: 'application/pdf',
    upsert: true,
  });
  const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
  const pdfUrl = urlData.publicUrl;

  const { data: program } = await db.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.notes || null,
  }).select().single();

  const market = detectMarket(client.phone);
  const hinglish = isHinglish(market);
  const focus = programData.focus || (hinglish ? 'Is hafte full push!' : 'Push hard this week!');

  const msgBody = hinglish
    ? `Week ${week_no} ka program ready hai! \u{1F4CB}\u{1F525}\n\n${focus}\n\nPDF: ${pdfUrl}\n\nKoi doubt ho toh message karo!`
    : `Your Week ${week_no} program is ready! \u{1F4CB}\u{1F525}\n\n${focus}\n\nPDF: ${pdfUrl}\n\nAny questions? Just message!`;

  await sendWhatsApp({
    phone: client.phone,
    templateName: 'weekly_program',
    body: msgBody,
  });

  if (program?.id) {
    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);
  }

  res.json({ ok: true, programId: program?.id, pdfUrl });
};

async function buildPDF(client, weekNo, data) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const BLACK = rgb(0.17, 0.17, 0.17);
  const GOLD = rgb(0.72, 0.59, 0.35);
  const WHITE = rgb(1, 1, 1);
  const GREY = rgb(0.42, 0.42, 0.42);
  const LIGHT = rgb(0.85, 0.85, 0.85);

  // Cover page
  let page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: BLACK });
  page.drawRectangle({ x: 40, y: 40, width: 515, height: 762, borderColor: GOLD, borderWidth: 1, color: rgb(0, 0, 0), opacity: 0 });
  page.drawText('FITNESS BY MADDY', { x: 60, y: 760, size: 14, font: fontBold, color: GOLD });
  page.drawRectangle({ x: 60, y: 748, width: 80, height: 2, color: GOLD });
  page.drawText(`WEEK ${weekNo}`, { x: 60, y: 680, size: 52, font: fontBold, color: WHITE });
  page.drawText('PROGRAM', { x: 60, y: 625, size: 52, font: fontBold, color: GOLD });
  page.drawText(client.name || 'Client', { x: 60, y: 570, size: 16, font, color: LIGHT });
  if (data.focus) {
    page.drawText(data.focus, { x: 60, y: 545, size: 13, font, color: GOLD });
  }

  // Workout page(s)
  page = doc.addPage([595, 842]);
  let y = 790;
  page.drawText('WORKOUT PLAN', { x: 50, y, size: 22, font: fontBold, color: BLACK });
  y -= 8;
  page.drawRectangle({ x: 50, y, width: 120, height: 3, color: GOLD });
  y -= 30;

  if (data.workout_plan?.days) {
    for (const day of data.workout_plan.days) {
      if (y < 100) { page = doc.addPage([595, 842]); y = 790; }
      page.drawText(`${day.day.toUpperCase()}${day.focus ? '  —  ' + day.focus : ''}`, {
        x: 50, y, size: 13, font: fontBold, color: BLACK,
      });
      y -= 20;
      if (day.exercises) {
        for (const ex of day.exercises) {
          if (y < 60) { page = doc.addPage([595, 842]); y = 790; }
          const line = `${ex.name}   |   ${ex.sets} x ${ex.reps}   |   Rest: ${ex.rest || '60s'}`;
          page.drawText(line, { x: 70, y, size: 10, font, color: GREY });
          y -= 16;
          if (ex.notes) {
            const note = ex.notes.length > 70 ? ex.notes.slice(0, 67) + '...' : ex.notes;
            page.drawText(`  > ${note}`, { x: 80, y, size: 9, font, color: GOLD });
            y -= 14;
          }
        }
      }
      y -= 14;
    }
  }

  if (data.workout_plan?.cardio) {
    if (y < 100) { page = doc.addPage([595, 842]); y = 790; }
    y -= 6;
    page.drawText('CARDIO', { x: 50, y, size: 13, font: fontBold, color: BLACK });
    y -= 18;
    const c = data.workout_plan.cardio;
    page.drawText(`${c.type || 'Cardio'}  |  ${c.frequency || '3x/week'}  |  ${c.duration || '20-30 min'}`, {
      x: 70, y, size: 10, font, color: GREY,
    });
  }

  // Nutrition page
  page = doc.addPage([595, 842]);
  y = 790;
  page.drawText('NUTRITION PLAN', { x: 50, y, size: 22, font: fontBold, color: BLACK });
  y -= 8;
  page.drawRectangle({ x: 50, y, width: 130, height: 3, color: GOLD });
  y -= 30;

  const np = data.nutrition_plan;
  if (np) {
    page.drawText(`Daily Target:  ${np.calories || '—'} kcal`, { x: 50, y, size: 14, font: fontBold, color: BLACK });
    y -= 22;
    page.drawText(`Protein: ${np.protein_g || '—'}g   |   Carbs: ${np.carbs_g || '—'}g   |   Fat: ${np.fat_g || '—'}g`, {
      x: 50, y, size: 11, font, color: GREY,
    });
    y -= 32;

    if (np.meals) {
      for (const meal of np.meals) {
        if (y < 80) { page = doc.addPage([595, 842]); y = 790; }
        page.drawText(meal.meal.toUpperCase(), { x: 50, y, size: 12, font: fontBold, color: BLACK });
        y -= 18;
        if (meal.options) {
          for (const opt of meal.options) {
            if (y < 60) { page = doc.addPage([595, 842]); y = 790; }
            const text = opt.length > 80 ? opt.slice(0, 77) + '...' : opt;
            page.drawText(`•  ${text}`, { x: 70, y, size: 10, font, color: GREY });
            y -= 15;
          }
        }
        y -= 10;
      }
    }

    if (np.supplements && np.supplements.length) {
      if (y < 80) { page = doc.addPage([595, 842]); y = 790; }
      y -= 6;
      page.drawText('SUPPLEMENTS', { x: 50, y, size: 12, font: fontBold, color: BLACK });
      y -= 18;
      for (const s of np.supplements) {
        page.drawText(`•  ${s}`, { x: 70, y, size: 10, font, color: GREY });
        y -= 15;
      }
    }

    if (np.hydration) {
      y -= 10;
      page.drawText(`Hydration:  ${np.hydration}`, { x: 50, y, size: 10, font, color: GOLD });
    }
  }

  // Coach's note page
  if (data.notes) {
    page = doc.addPage([595, 842]);
    y = 790;
    page.drawText("COACH'S NOTE", { x: 50, y, size: 22, font: fontBold, color: BLACK });
    y -= 8;
    page.drawRectangle({ x: 50, y, width: 110, height: 3, color: GOLD });
    y -= 30;

    const words = data.notes.split(' ');
    let line = '';
    for (const word of words) {
      if ((line + ' ' + word).length > 75) {
        page.drawText(line.trim(), { x: 50, y, size: 11, font, color: GREY });
        y -= 18;
        line = word;
        if (y < 60) { page = doc.addPage([595, 842]); y = 790; }
      } else {
        line += ' ' + word;
      }
    }
    if (line.trim()) {
      page.drawText(line.trim(), { x: 50, y, size: 11, font, color: GREY });
    }
  }

  return doc.save();
}
