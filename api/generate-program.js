const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { corsHeaders, maskPhone } = require('../lib/utils');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const SAFETY_KEYWORDS = [
  'extreme calorie', 'under 1000', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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

    const clientContext = {
      name: client.name,
      program: client.program,
      week: week_no,
      started: client.program_started_at,
      checkins: (recentCheckins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues
      }))
    };

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are a certified fitness program architect for FitnessByMaddy.
Create a weekly workout and nutrition plan based on the client data provided.
Output valid JSON with two keys: "workout_plan" and "nutrition_plan".
workout_plan: array of 6 day objects with {day, focus, exercises: [{name, sets, reps, rest, notes}]}, plus 1 rest day.
nutrition_plan: {daily_calories, protein_g, carbs_g, fat_g, meals: [{meal, foods, approx_calories}], notes}.
Be evidence-based. No extreme cuts. No banned substances. Safe, progressive, sustainable.`,
        messages: [{
          role: 'user',
          content: `Generate Week ${week_no} program for this client:\n${JSON.stringify(clientContext, null, 2)}`
        }]
      })
    });

    if (!claudeResponse.ok) {
      throw new Error(`Claude API error: ${claudeResponse.status}`);
    }

    const claudeData = await claudeResponse.json();
    const rawText = claudeData.content[0].text;

    const safetyCheck = SAFETY_KEYWORDS.some(kw => rawText.toLowerCase().includes(kw));
    if (safetyCheck) {
      await notifyMaddy(
        'Program flagged — safety review needed',
        `Client: ${maskPhone(client.phone)}, Week ${week_no}\nFlagged content detected in generated program.`
      );
      return res.status(200).json({ action: 'flagged_for_review', client_id, week_no });
    }

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Failed to parse Claude response as JSON');
    }

    const { workout_plan, nutrition_plan } = parsed;

    const pdfBytes = await generatePDF(client, week_no, workout_plan, nutrition_plan);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: publicUrl } = db.storage.from('client-files').getPublicUrl(pdfPath);

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl.publicUrl,
      workout_plan,
      nutrition_plan,
      notes: `Auto-generated Week ${week_no}`
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      publicUrl.publicUrl
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: publicUrl.publicUrl });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generatePDF(client, weekNo, workout, nutrition) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0.17, 0.17, 0.17);
  const gold = rgb(0.72, 0.59, 0.35);
  const white = rgb(1, 1, 1);

  // Cover page
  let page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: black });
  page.drawText('FITNESS BY MADDY', { x: 50, y: 750, size: 14, font: fontBold, color: gold });
  page.drawText(`WEEK ${weekNo} PROGRAM`, { x: 50, y: 700, size: 32, font: fontBold, color: white });
  page.drawText(`Prepared for ${client.name || 'Client'}`, { x: 50, y: 660, size: 14, font, color: gold });
  page.drawText(`Program: ${client.program || '12-Week'}`, { x: 50, y: 635, size: 12, font, color: rgb(0.6, 0.6, 0.6) });

  // Workout pages
  if (Array.isArray(workout)) {
    for (const day of workout) {
      page = doc.addPage([595, 842]);
      let y = 790;
      page.drawRectangle({ x: 0, y: 820, width: 595, height: 22, color: black });
      page.drawText('FITNESS BY MADDY', { x: 20, y: 825, size: 8, font, color: gold });

      page.drawText(day.day || 'Training Day', { x: 50, y, size: 20, font: fontBold, color: black });
      y -= 25;
      page.drawText(day.focus || '', { x: 50, y, size: 12, font, color: gold });
      y -= 30;

      if (Array.isArray(day.exercises)) {
        for (const ex of day.exercises) {
          if (y < 80) { page = doc.addPage([595, 842]); y = 790; }
          page.drawText(ex.name || '', { x: 50, y, size: 11, font: fontBold, color: black });
          y -= 16;
          const detail = `${ex.sets || ''}x${ex.reps || ''} | Rest: ${ex.rest || '60s'}`;
          page.drawText(detail, { x: 70, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
          y -= 14;
          if (ex.notes) {
            page.drawText(ex.notes, { x: 70, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
            y -= 14;
          }
          y -= 6;
        }
      }
    }
  }

  // Nutrition page
  if (nutrition) {
    page = doc.addPage([595, 842]);
    let y = 790;
    page.drawRectangle({ x: 0, y: 820, width: 595, height: 22, color: black });
    page.drawText('FITNESS BY MADDY', { x: 20, y: 825, size: 8, font, color: gold });

    page.drawText('NUTRITION PLAN', { x: 50, y, size: 20, font: fontBold, color: black });
    y -= 30;

    const macros = `Calories: ${nutrition.daily_calories || '-'} | Protein: ${nutrition.protein_g || '-'}g | Carbs: ${nutrition.carbs_g || '-'}g | Fat: ${nutrition.fat_g || '-'}g`;
    page.drawText(macros, { x: 50, y, size: 11, font: fontBold, color: gold });
    y -= 30;

    if (Array.isArray(nutrition.meals)) {
      for (const meal of nutrition.meals) {
        if (y < 80) { page = doc.addPage([595, 842]); y = 790; }
        page.drawText(meal.meal || '', { x: 50, y, size: 12, font: fontBold, color: black });
        y -= 18;
        const foods = Array.isArray(meal.foods) ? meal.foods.join(', ') : (meal.foods || '');
        const lines = wrapText(foods, 80);
        for (const line of lines) {
          page.drawText(line, { x: 70, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
          y -= 14;
        }
        if (meal.approx_calories) {
          page.drawText(`~${meal.approx_calories} cal`, { x: 70, y, size: 9, font, color: rgb(0.6, 0.6, 0.6) });
          y -= 14;
        }
        y -= 8;
      }
    }

    if (nutrition.notes) {
      y -= 10;
      page.drawText('Notes:', { x: 50, y, size: 11, font: fontBold, color: black });
      y -= 16;
      const noteLines = wrapText(nutrition.notes, 85);
      for (const line of noteLines) {
        if (y < 60) break;
        page.drawText(line, { x: 50, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
        y -= 14;
      }
    }
  }

  return await doc.save();
}

function wrapText(text, maxChars) {
  if (!text) return [];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      lines.push(current.trim());
      current = word;
    } else {
      current += ' ' + word;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}
