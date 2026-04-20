const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const RISKY_KEYWORDS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'clenbuterol', 'dnp', 'steroids', 'sarms', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-internal-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildProgramPrompt(client, recentCheckins || [], lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const programText = response.content[0].text;

    if (containsRiskyContent(programText)) {
      await supabase.from('programs').insert({
        client_id,
        week_no,
        notes: 'FLAGGED_FOR_REVIEW: Risky content detected',
        workout_plan: null,
        nutrition_plan: null
      });
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    const { workoutPlan, nutritionPlan } = parseProgramResponse(programText);

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes: `Generated for Week ${week_no}`
      })
      .select()
      .single();

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const pdfContent = generatePdfContent(client, workoutPlan, nutritionPlan, week_no);
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('clients').upload(pdfPath, Buffer.from(pdfContent), {
      contentType: 'application/pdf'
    });

    await supabase
      .from('programs')
      .update({ pdf_url: pdfPath })
      .eq('id', program.id);

    const contextNote = buildContextNote(recentCheckins, week_no);
    await sendWhatsApp({
      phone: client.phone,
      body: `📋 Week ${week_no} program is ready!\n\n${contextNote}\n\nYour updated workout and nutrition plan has been uploaded. Keep pushing! 💪`
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildProgramPrompt(client, checkins, lastProgram, weekNo) {
  const latestCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a NASM-certified program architect for FitnessByMaddy. Generate a week ${weekNo} training and nutrition program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

${latestCheckin ? `LATEST CHECK-IN (Week ${latestCheckin.week_no}):
- Weight: ${latestCheckin.weight || 'N/A'}
- Waist: ${latestCheckin.waist || 'N/A'}
- Compliance: ${latestCheckin.compliance_score}/10
- Energy: ${latestCheckin.energy}/10
- Issues: ${latestCheckin.issues || 'None'}` : 'No check-in data yet.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

${lastProgram ? `LAST PROGRAM NOTES: ${lastProgram.notes || 'Standard progression'}` : ''}

RULES:
- Design a progressive overload plan suitable for the client's level
- Never prescribe extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Adjust intensity based on compliance and energy scores
- If energy is low (<5), reduce volume and add recovery protocols
- Include warm-up, main workout (4-5 exercises), and cool-down for each day

OUTPUT FORMAT (respond in valid JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": N, "reps": "...", "rest": "..."}] }
    ],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": N,
    "protein_g": N,
    "carbs_g": N,
    "fats_g": N,
    "meals": [{"time": "...", "description": "..."}],
    "notes": "..."
  },
  "focus_note": "One sentence summary of this week's priority"
}`;
}

function containsRiskyContent(text) {
  const lower = text.toLowerCase();
  return RISKY_KEYWORDS.some(kw => lower.includes(kw));
}

function parseProgramResponse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { workoutPlan: null, nutritionPlan: null };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      workoutPlan: parsed.workout_plan || null,
      nutritionPlan: parsed.nutrition_plan || null
    };
  } catch {
    return { workoutPlan: { raw: text }, nutritionPlan: null };
  }
}

function generatePdfContent(client, workoutPlan, nutritionPlan, weekNo) {
  // Simple text-based content (actual PDF rendering would use a library)
  const lines = [
    `FITNESS BY MADDY - Week ${weekNo} Program`,
    `Client: ${client.name || 'Client'}`,
    `Program: ${client.program}`,
    `Generated: ${new Date().toISOString().split('T')[0]}`,
    '',
    '=== WORKOUT PLAN ===',
    JSON.stringify(workoutPlan, null, 2),
    '',
    '=== NUTRITION PLAN ===',
    JSON.stringify(nutritionPlan, null, 2)
  ];
  return lines.join('\n');
}

function buildContextNote(checkins, weekNo) {
  if (!checkins || checkins.length === 0) return 'Starting strong with Week 1!';
  const latest = checkins[0];
  if (latest.energy && latest.energy < 5) {
    return `Noticed your energy was ${latest.energy}/10 last week — adjusted this week for better recovery.`;
  }
  if (latest.compliance_score && latest.compliance_score >= 8) {
    return `Great compliance last week (${latest.compliance_score}/10)! Progressing intensity this week.`;
  }
  return `Week ${weekNo} adjusted based on your latest check-in. Let's keep the momentum!`;
}
