const { getSupabase } = require('./lib/supabase');
const { sendWhatsAppWithMedia } = require('./lib/whatsapp');
const { escalateToMaddy, maskPhone } = require('./lib/escalation');

const UNSAFE_PATTERNS = [
  /\b(under|below)\s*1[0-2]00\s*cal/i,
  /\bDNP\b/i,
  /\bclenbuterol\b/i,
  /\bsteroids?\b/i,
  /\bephedra\b/i,
  /lose\s+\d{2,}\s*(kg|lbs?|pounds?)\s+(in|per)\s+(a\s+)?week/i,
];

function containsUnsafeContent(text) {
  return UNSAFE_PATTERNS.some((p) => p.test(text));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const checkinContext = (recentCheckins || [])
      .map(
        (c) =>
          `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`
      )
      .join('\n');

    const prompt = `You are a certified fitness program architect for FitnessByMaddy. Generate Week ${week_no} of a 12-week personalized program.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinContext || 'No previous check-ins (Week 1)'}

REQUIREMENTS:
- Generate a complete 7-day workout plan with exercises, sets, reps, rest periods
- Generate a daily nutrition plan with meals, macros, and calorie targets
- Be progressive: increase intensity/volume appropriately based on check-in data
- If compliance is low, simplify slightly to improve adherence
- If energy is low, consider deload or nutrition adjustments
- Include a "focus note" for the week

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ]
  },
  "week_focus": "...",
  "notes": "..."
}

Return ONLY valid JSON. No markdown.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || '';

    if (containsUnsafeContent(responseText)) {
      await escalateToMaddy(
        'Unsafe content in generated program',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nFlagged content detected — program held for review.`
      );
      return res.status(200).json({
        success: false,
        reason: 'Content flagged for review',
      });
    }

    let programData;
    try {
      programData = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        programData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse Claude response as JSON');
      }
    }

    const pdfHtml = generatePdfHtml(client, week_no, programData);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');

    const filePath = `clients/${client_id}/week_${week_no}.html`;
    await db.storage.from('client-files').upload(filePath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { error: dbErr } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || programData.week_focus,
    });

    if (dbErr) throw dbErr;

    const contextNote = programData.week_focus || `Week ${week_no} program is ready!`;
    await sendWhatsAppWithMedia(
      client.phone,
      `Week ${week_no} Program\n\n${contextNote}\n\nView your plan: ${pdfUrl}`,
      pdfUrl,
      'weekly_program'
    );

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function generatePdfHtml(client, weekNo, data) {
  const workout = data.workout_plan;
  const nutrition = data.nutrition_plan;

  const daysHtml = (workout?.days || [])
    .map(
      (day) => `
    <div class="day-card">
      <h3>${day.day} — ${day.focus}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr>
        ${(day.exercises || [])
          .map(
            (ex) =>
              `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest}</td><td>${ex.notes || ''}</td></tr>`
          )
          .join('')}
      </table>
    </div>`
    )
    .join('');

  const mealsHtml = (nutrition?.meals || [])
    .map(
      (m) => `
    <div class="meal-item">
      <strong>${m.meal}</strong>
      <ul>${(m.options || []).map((o) => `<li>${o}</li>`).join('')}</ul>
      <small>${m.macros || ''}</small>
    </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff; padding: 40px; }
  .header { text-align: center; margin-bottom: 48px; border-bottom: 2px solid #B8965A; padding-bottom: 32px; }
  .header h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: #B8965A; letter-spacing: 4px; }
  .header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #fff; letter-spacing: 2px; margin-top: 8px; }
  .header p { color: #888; font-size: 14px; margin-top: 8px; }
  .section-title { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; letter-spacing: 2px; margin: 32px 0 16px; }
  .day-card { background: #2a2a2a; border-radius: 8px; padding: 24px; margin-bottom: 16px; border-left: 3px solid #B8965A; }
  .day-card h3 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #B8965A; margin-bottom: 16px; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #333; color: #B8965A; padding: 10px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  td { padding: 10px; border-bottom: 1px solid #333; font-size: 14px; color: #ccc; }
  .nutrition-box { background: #2a2a2a; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
  .macros { display: flex; gap: 24px; margin-bottom: 24px; }
  .macro-item { background: #333; padding: 16px 24px; border-radius: 8px; text-align: center; flex: 1; }
  .macro-item .num { font-family: 'Bebas Neue', sans-serif; font-size: 32px; color: #B8965A; }
  .macro-item .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .meal-item { padding: 16px 0; border-bottom: 1px solid #333; }
  .meal-item strong { color: #B8965A; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
  .meal-item ul { margin: 8px 0 4px 20px; }
  .meal-item li { color: #ccc; font-size: 14px; margin: 4px 0; }
  .meal-item small { color: #666; }
  .focus-note { background: linear-gradient(135deg, #B8965A, #8B6914); color: #1a1a1a; padding: 24px; border-radius: 8px; margin-top: 32px; text-align: center; }
  .focus-note h3 { font-family: 'Bebas Neue', sans-serif; font-size: 24px; letter-spacing: 2px; margin-bottom: 8px; }
  .focus-note p { font-size: 16px; font-weight: 500; }
  .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #333; color: #555; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <h1>FITNESS BY MADDY</h1>
    <h2>Week ${weekNo} Program</h2>
    <p>${client.name} | ${client.program.replace(/_/g, ' ').toUpperCase()}</p>
  </div>

  <div class="section-title">WORKOUT PLAN</div>
  ${daysHtml}

  <div class="section-title">NUTRITION PLAN</div>
  <div class="nutrition-box">
    <div class="macros">
      <div class="macro-item"><div class="num">${nutrition?.daily_calories || '—'}</div><div class="label">Calories</div></div>
      <div class="macro-item"><div class="num">${nutrition?.protein_g || '—'}g</div><div class="label">Protein</div></div>
      <div class="macro-item"><div class="num">${nutrition?.carbs_g || '—'}g</div><div class="label">Carbs</div></div>
      <div class="macro-item"><div class="num">${nutrition?.fat_g || '—'}g</div><div class="label">Fat</div></div>
    </div>
    ${mealsHtml}
  </div>

  ${data.week_focus ? `<div class="focus-note"><h3>THIS WEEK'S FOCUS</h3><p>${data.week_focus}</p></div>` : ''}

  <div class="footer">FITNESS BY MADDY | fitnessbymaddy.com</div>
</body>
</html>`;
}
