import Anthropic from '@anthropic-ai/sdk';
import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { jsonResponse, corsHeaders } from '../lib/helpers.js';

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i,
];

export default async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'POST only' }, 405);

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return jsonResponse(res, { error: 'client_id and week_no required' }, 400);
  }

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return jsonResponse(res, { error: 'Client not found' }, 404);

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy. Generate a weekly training and nutrition plan.

RULES:
- Never prescribe fewer than 1400 calories for women or 1600 for men
- Never recommend banned substances, SARMs, or extreme protocols
- Base recommendations on the client's current stats and recent progress
- Be specific: exact exercises, sets, reps, rest periods
- Nutrition: daily calories, macro split, 3 meal examples
- Output valid JSON with "workout_plan" and "nutrition_plan" keys`;

    const userPrompt = buildPrompt(client, intake, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = response.content[0].text;

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(content)) {
        await supabase.from('programs').insert({
          client_id,
          week_no,
          notes: `FLAGGED FOR REVIEW: matched safety pattern ${pattern}`,
          workout_plan: null,
          nutrition_plan: null,
        });
        return jsonResponse(res, { error: 'Program flagged for Maddy review', flagged: true }, 422);
      }
    }

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      parsed = { workout_plan: { raw: content }, nutrition_plan: {} };
    }

    const pdfContent = generatePdfHtml(client, parsed, week_no);
    const pdfBlob = new Blob([pdfContent], { type: 'text/html' });
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await supabase.storage.from('clients').upload(pdfPath, pdfBlob, { upsert: true });

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: parsed.workout_plan || parsed,
      nutrition_plan: parsed.nutrition_plan || {},
      notes: `Generated for week ${week_no}`,
    }).select().single();

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      urlData?.publicUrl || 'Check your dashboard',
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return jsonResponse(res, { ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return jsonResponse(res, { error: 'Generation failed' }, 500);
  }
}

function buildPrompt(client, intake, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Unknown'}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'N/A'}\n`;
    prompt += `Gender: ${intake.gender || 'N/A'}\n`;
    prompt += `Goal: ${intake.goal || 'N/A'}\n`;
    prompt += `Injuries: ${intake.injuries || 'None'}\n`;
    prompt += `Diet preference: ${intake.diet_pref || 'N/A'}\n`;
    prompt += `Schedule: ${intake.schedule || 'N/A'}\n`;
    prompt += `Experience: ${intake.experience || 'N/A'}\n`;
  }

  if (checkins && checkins.length > 0) {
    prompt += '\nRecent check-ins:\n';
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, `;
      prompt += `Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10\n`;
      if (c.issues) prompt += `  Issues: ${c.issues}\n`;
    }
  }

  prompt += '\nReturn a JSON object with "workout_plan" (7 days of exercises with sets/reps/rest) and "nutrition_plan" (daily calories, macros, 3 sample meals).';
  return prompt;
}

function generatePdfHtml(client, plan, weekNo) {
  const workout = plan.workout_plan || {};
  const nutrition = plan.nutrition_plan || {};

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name || 'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#0a0a0a;color:#e0e0e0;padding:40px 24px}
.header{text-align:center;border-bottom:2px solid #B8965A;padding-bottom:32px;margin-bottom:40px}
.brand{font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:6px;color:#B8965A;text-transform:uppercase}
h1{font-family:'Bebas Neue',sans-serif;font-size:48px;color:white;letter-spacing:3px;margin-top:8px}
.subtitle{color:#888;font-size:14px;margin-top:4px}
h2{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#B8965A;letter-spacing:2px;margin:32px 0 16px;border-left:3px solid #B8965A;padding-left:12px}
h3{font-size:16px;font-weight:600;color:white;margin:20px 0 8px}
.day{background:#141414;border:1px solid #222;border-radius:4px;padding:20px;margin-bottom:12px}
.day-title{font-family:'Bebas Neue',sans-serif;font-size:20px;color:#B8965A;margin-bottom:8px}
table{width:100%;border-collapse:collapse;margin:8px 0}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666;padding:8px;border-bottom:1px solid #222}
td{padding:8px;font-size:13px;border-bottom:1px solid #1a1a1a;color:#ccc}
.nutrition-card{background:#141414;border:1px solid #222;border-radius:4px;padding:20px;margin-bottom:12px}
.macro-row{display:flex;gap:16px;margin:12px 0}
.macro{flex:1;background:#1a1a1a;padding:12px;border-radius:4px;text-align:center}
.macro-val{font-family:'Bebas Neue',sans-serif;font-size:28px;color:#B8965A}
.macro-label{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px}
.footer{text-align:center;margin-top:48px;padding-top:24px;border-top:1px solid #222;color:#444;font-size:12px}
</style>
</head>
<body>
<div class="header">
  <div class="brand">Fitness by Maddy</div>
  <h1>WEEK ${weekNo} PROGRAM</h1>
  <div class="subtitle">${client.name || 'Client'} &middot; ${client.program || 'Custom Program'}</div>
</div>

<h2>WORKOUT PLAN</h2>
<pre style="background:#141414;padding:20px;border-radius:4px;font-size:13px;color:#ccc;overflow-x:auto;white-space:pre-wrap">${JSON.stringify(workout, null, 2)}</pre>

<h2>NUTRITION PLAN</h2>
<pre style="background:#141414;padding:20px;border-radius:4px;font-size:13px;color:#ccc;overflow-x:auto;white-space:pre-wrap">${JSON.stringify(nutrition, null, 2)}</pre>

<div class="footer">
  Fitness by Maddy &middot; fitnessbymaddy.com &middot; NASM Certified
</div>
</body>
</html>`;
}
