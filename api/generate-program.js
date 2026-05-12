const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  try {
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect working for Fitness by Maddy, an elite online coaching brand. You create weekly workout and nutrition plans that are safe, science-backed, and personalized.

RULES:
- Never recommend extreme calorie cuts (below 1200 kcal for women, 1500 kcal for men)
- Never recommend banned or dangerous supplements
- Never promise specific weight loss timelines
- Always include warm-up and cool-down
- Consider injuries and medical conditions
- Scale difficulty progressively
- Output valid JSON only`;

    const clientContext = buildClientContext(client, checkins, intake, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Generate Week ${week_no} program for this client:\n\n${clientContext}\n\nReturn JSON with this structure:\n{\n  "workout_plan": {\n    "days": [\n      { "day": "Monday", "focus": "Upper Body", "exercises": [{ "name": "", "sets": 0, "reps": "", "rest": "", "notes": "" }], "warmup": "", "cooldown": "" }\n    ],\n    "rest_days": ["Sunday"],\n    "notes": ""\n  },\n  "nutrition_plan": {\n    "daily_calories": 0,\n    "protein_g": 0,\n    "carbs_g": 0,\n    "fats_g": 0,\n    "meal_timing": [],\n    "hydration": "",\n    "supplements": [],\n    "notes": ""\n  },\n  "weekly_focus": "",\n  "coach_note": ""\n}`,
        },
      ],
    });

    const content = response.content[0].text;
    let programData;

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (parseErr) {
      await escalateToMaddy(
        'Program generation parse error',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nError: ${parseErr.message}`
      );
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    if (isFlagged(programData)) {
      await escalateToMaddy(
        'Program flagged for review',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nReason: Potentially unsafe recommendations detected`
      );
      return res.status(200).json({ status: 'flagged_for_review' });
    }

    const pdfHtml = renderProgramPdf(client, week_no, programData);
    const pdfBuffer = Buffer.from(pdfHtml, 'utf-8');
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'text/html',
      upsert: true,
    });

    const { data: publicUrl } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || pdfPath,
      whatsapp_sent_at: null,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || null,
    }).select().single();

    if (error) throw error;

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name,
      templateParams: [
        client.name,
        `${week_no}`,
        programData.weekly_focus || 'Keep pushing!',
      ],
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ status: 'ok', program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildClientContext(client, checkins, intake, weekNo) {
  let ctx = `Name: ${client.name}\nProgram: ${client.program}\nWeek: ${weekNo}\n`;

  if (intake) {
    ctx += `Age: ${intake.age || 'N/A'}\nGender: ${intake.gender || 'N/A'}\n`;
    ctx += `Goal: ${intake.goal || 'N/A'}\nInjuries: ${intake.injuries || 'None'}\n`;
    ctx += `Diet: ${intake.diet_pref || 'No preference'}\nSchedule: ${intake.schedule || 'N/A'}\n`;
    ctx += `Experience: ${intake.experience_level || 'N/A'}\nMedical: ${intake.medical_conditions || 'None'}\n`;
  }

  if (checkins && checkins.length > 0) {
    ctx += '\nRecent Check-ins:\n';
    for (const ci of checkins) {
      ctx += `  Week ${ci.week_no}: Weight=${ci.weight || 'N/A'}kg, Waist=${ci.waist || 'N/A'}cm, `;
      ctx += `Compliance=${ci.compliance_score || 'N/A'}/10, Energy=${ci.energy || 'N/A'}/10\n`;
      if (ci.issues) ctx += `  Issues: ${ci.issues}\n`;
    }
  }

  return ctx;
}

function isFlagged(programData) {
  if (!programData?.nutrition_plan) return false;
  const cal = programData.nutrition_plan.daily_calories;
  if (cal && cal < 1200) return true;
  const supps = programData.nutrition_plan.supplements || [];
  const banned = ['dnp', 'clenbuterol', 'ephedra', 'sibutramine', 'steroids'];
  for (const s of supps) {
    if (banned.some(b => s.toLowerCase().includes(b))) return true;
  }
  return false;
}

function renderProgramPdf(client, weekNo, data) {
  const wp = data.workout_plan || {};
  const np = data.nutrition_plan || {};

  let daysHtml = '';
  if (wp.days) {
    for (const day of wp.days) {
      let exercises = '';
      if (day.exercises) {
        for (const ex of day.exercises) {
          exercises += `<tr><td>${ex.name}</td><td>${ex.sets}x${ex.reps}</td><td>${ex.rest || '-'}</td><td>${ex.notes || ''}</td></tr>`;
        }
      }
      daysHtml += `
        <div class="day-block">
          <h3>${day.day} — ${day.focus}</h3>
          ${day.warmup ? `<p class="note">Warm-up: ${day.warmup}</p>` : ''}
          <table><thead><tr><th>Exercise</th><th>Sets x Reps</th><th>Rest</th><th>Notes</th></tr></thead><tbody>${exercises}</tbody></table>
          ${day.cooldown ? `<p class="note">Cool-down: ${day.cooldown}</p>` : ''}
        </div>`;
    }
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#1a1a1a;color:#fff;padding:40px 24px}
.header{text-align:center;padding:40px 0;border-bottom:2px solid #B8965A}
.header h1{font-family:'Bebas Neue',sans-serif;font-size:48px;color:#B8965A;letter-spacing:4px}
.header h2{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#fff;letter-spacing:2px;margin-top:8px}
.header p{color:#999;font-size:14px;margin-top:8px}
.section{margin:32px 0;padding:24px 0;border-bottom:1px solid #333}
.section h2{font-family:'Bebas Neue',sans-serif;font-size:32px;color:#B8965A;letter-spacing:2px;margin-bottom:16px}
.day-block{margin:24px 0;padding:20px;background:#222;border-radius:4px;border-left:3px solid #B8965A}
.day-block h3{font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;margin-bottom:12px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #333;font-size:13px}
th{color:#B8965A;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:11px}
.note{color:#999;font-size:13px;font-style:italic;margin:8px 0}
.macro-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:16px 0}
.macro-box{background:#222;padding:20px;border-radius:4px;text-align:center}
.macro-box .num{font-family:'Bebas Neue',sans-serif;font-size:36px;color:#B8965A}
.macro-box .label{font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
.coach-note{background:#222;border-left:3px solid #B8965A;padding:20px;margin:24px 0;border-radius:4px}
.footer{text-align:center;padding:32px 0;color:#666;font-size:12px;border-top:1px solid #333;margin-top:40px}
</style></head><body>
<div class="header">
  <h1>Fitness by Maddy</h1>
  <h2>Week ${weekNo} Program</h2>
  <p>${client.name} — ${client.program.toUpperCase()}</p>
</div>
<div class="section"><h2>Workout Plan</h2>${daysHtml}
${wp.rest_days ? `<p class="note">Rest Days: ${wp.rest_days.join(', ')}</p>` : ''}
${wp.notes ? `<p class="note">${wp.notes}</p>` : ''}
</div>
<div class="section"><h2>Nutrition Plan</h2>
<div class="macro-grid">
  <div class="macro-box"><div class="num">${np.daily_calories || '-'}</div><div class="label">Calories</div></div>
  <div class="macro-box"><div class="num">${np.protein_g || '-'}g</div><div class="label">Protein</div></div>
  <div class="macro-box"><div class="num">${np.carbs_g || '-'}g</div><div class="label">Carbs</div></div>
  <div class="macro-box"><div class="num">${np.fats_g || '-'}g</div><div class="label">Fats</div></div>
</div>
${np.hydration ? `<p class="note">Hydration: ${np.hydration}</p>` : ''}
${np.supplements?.length ? `<p class="note">Supplements: ${np.supplements.join(', ')}</p>` : ''}
${np.notes ? `<p class="note">${np.notes}</p>` : ''}
</div>
${data.coach_note ? `<div class="coach-note"><strong>Coach's Note:</strong> ${data.coach_note}</div>` : ''}
<div class="footer">Fitness by Maddy — fitnessbymaddy.com<br>This program is personalised for ${client.name}. Do not share.</div>
</body></html>`;
}
