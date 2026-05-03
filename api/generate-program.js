const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');
const { escalateToMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'sarms', 'steroids',
  'lose 10kg in 1 week', 'lose 20 pounds in 2 weeks',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('intake_data').eq('id', client.lead_id).single()
      : { data: null };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy, an elite online coaching brand. Generate evidence-based, safe workout and nutrition plans.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or supplements without research backing
- Never promise specific weight loss timelines
- Progressive overload: increase volume/intensity by 5-10% weekly
- Include deload weeks every 4th week
- All exercises must have proper form cues
- Nutrition must include adequate protein (1.6-2.2g/kg bodyweight)

Output strict JSON with this structure:
{
  "workout_plan": {
    "days": [{ "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }] }],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [{ "meal": "Breakfast", "options": ["..."] }],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "..."
}`;

    const checkinSummary = recentCheckins?.length
      ? recentCheckins.map(c =>
          `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues=${c.issues || 'none'}`
        ).join('\n')
      : 'No previous check-ins';

    const intakeInfo = lead?.intake_data
      ? `Intake: age=${lead.intake_data.age}, gender=${lead.intake_data.gender}, goal=${lead.intake_data.goal}, injuries=${lead.intake_data.injuries || 'none'}, diet=${lead.intake_data.diet_preference || 'flexible'}, weight=${lead.intake_data.current_weight}kg, height=${lead.intake_data.height}cm, target=${lead.intake_data.target_weight}kg`
      : `Client: ${client.name || 'Unknown'}, program=${client.program}`;

    const userPrompt = `Generate Week ${week_no} program for this client.

${intakeInfo}

Recent check-ins:
${checkinSummary}

Program type: ${client.program}
Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}

Provide the full workout + nutrition plan as JSON.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    if (hasSafetyIssue(rawText)) {
      await escalateToMaddy(
        'Program safety flag',
        `Client: ${client.name} (${maskPhone(client.phone)}), Week ${week_no}\nFlagged content detected in generated program. Review required before sending.`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: null,
        nutrition_plan: null,
        notes: 'FLAGGED FOR REVIEW - safety issue detected',
      });

      return res.json({ success: false, flagged: true, reason: 'Safety review needed' });
    }

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const pdfHtml = generateProgramPdfHtml(client, week_no, parsed);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');

    const filePath = `${client.id}/week_${week_no}.html`;
    await db.storage.from('clients').upload(filePath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: fileUrl } = db.storage.from('clients').getPublicUrl(filePath);

    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: fileUrl?.publicUrl || filePath,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes || null,
    });

    if (progErr) {
      console.error('Program insert error:', progErr);
    }

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [
        client.name || 'there',
        `${week_no}`,
        parsed.notes || 'New week, new gains. Check your program!',
      ],
      mediaUrl: fileUrl?.publicUrl || null,
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.json({ success: true, week_no, client_id });
  } catch (err) {
    console.error('Program generation error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generateProgramPdfHtml(client, weekNo, plan) {
  const workoutRows = (plan.workout_plan?.days || []).map(day => {
    const exercises = (day.exercises || []).map(ex =>
      `<tr>
        <td>${ex.name}</td>
        <td>${ex.sets} x ${ex.reps}</td>
        <td>${ex.rest || '-'}</td>
        <td>${ex.notes || ''}</td>
      </tr>`
    ).join('');
    return `<h3 style="color:#B8965A;margin:24px 0 8px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;">${day.day} — ${day.focus}</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr style="background:#2C2C2C;color:#fff;"><th style="padding:8px;text-align:left;">Exercise</th><th style="padding:8px;">Sets x Reps</th><th style="padding:8px;">Rest</th><th style="padding:8px;">Notes</th></tr>
      ${exercises}
    </table>`;
  }).join('');

  const mealRows = (plan.nutrition_plan?.meals || []).map(m =>
    `<div style="margin-bottom:12px;"><strong>${m.meal}:</strong> ${(m.options || []).join(' / ')}</div>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;600&display=swap" rel="stylesheet">
<style>
  body{font-family:'DM Sans',sans-serif;background:#FAF8F4;color:#2C2C2C;margin:0;padding:24px;max-width:800px;margin:0 auto;}
  h1{font-family:'Bebas Neue',sans-serif;font-size:36px;color:#2C2C2C;letter-spacing:3px;border-bottom:3px solid #B8965A;padding-bottom:12px;}
  h2{font-family:'Bebas Neue',sans-serif;font-size:24px;color:#2C2C2C;letter-spacing:2px;margin-top:32px;}
  table td,table th{padding:8px;border-bottom:1px solid #E8E3DC;font-size:14px;}
  .macro-box{display:inline-block;background:#2C2C2C;color:#B8965A;padding:12px 20px;margin:4px;border-radius:4px;text-align:center;}
  .macro-num{font-family:'Bebas Neue',sans-serif;font-size:28px;}
  .macro-label{font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;}
  .footer{margin-top:40px;padding-top:16px;border-top:1px solid #E8E3DC;font-size:12px;color:#999;text-align:center;}
</style></head><body>
<h1>FITNESS BY MADDY</h1>
<p style="color:#6B6B6B;">Week ${weekNo} Program for <strong>${client.name || 'Client'}</strong></p>

<h2>MACROS</h2>
<div>
  <div class="macro-box"><div class="macro-num">${plan.nutrition_plan?.calories || '-'}</div><div class="macro-label">Calories</div></div>
  <div class="macro-box"><div class="macro-num">${plan.nutrition_plan?.protein_g || '-'}g</div><div class="macro-label">Protein</div></div>
  <div class="macro-box"><div class="macro-num">${plan.nutrition_plan?.carbs_g || '-'}g</div><div class="macro-label">Carbs</div></div>
  <div class="macro-box"><div class="macro-num">${plan.nutrition_plan?.fat_g || '-'}g</div><div class="macro-label">Fat</div></div>
</div>

<h2>WORKOUT PLAN</h2>
${workoutRows}

${plan.workout_plan?.cardio ? `<h3 style="color:#B8965A;margin:24px 0 8px;font-family:'Bebas Neue',sans-serif;font-size:20px;">CARDIO</h3><p>${plan.workout_plan.cardio.type} — ${plan.workout_plan.cardio.duration}, ${plan.workout_plan.cardio.frequency}</p>` : ''}

<h2>NUTRITION PLAN</h2>
${mealRows}

${plan.nutrition_plan?.supplements?.length ? `<h3 style="color:#B8965A;margin-top:16px;">Supplements</h3><p>${plan.nutrition_plan.supplements.join(', ')}</p>` : ''}
${plan.nutrition_plan?.hydration ? `<p><strong>Hydration:</strong> ${plan.nutrition_plan.hydration}</p>` : ''}

${plan.notes ? `<h2>COACH NOTES</h2><p>${plan.notes}</p>` : ''}

<div class="footer">Fitness by Maddy | fitnessbymaddy.com | @fitnessbymaddy_</div>
</body></html>`;
}
