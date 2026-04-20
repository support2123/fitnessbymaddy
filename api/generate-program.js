const Anthropic = require('@anthropic-ai/sdk');
const { getClient } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getClient();

    // Fetch client
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Fetch last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Fetch intake data
    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    // Build prompt
    const prompt = buildPrompt(client, intake, checkins, week_no);

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0]?.text || '';

    // Parse JSON from response
    const parsed = parseProgram(responseText);
    if (!parsed) {
      return res.status(500).json({ error: 'Failed to parse program from Claude' });
    }

    // Safety check
    if (isFlagged(parsed)) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(client.phone, 'Program safety flag', `Week ${week_no}: program flagged for review`);
      return res.json({ ok: false, reason: 'flagged_for_review' });
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(
      client, week_no, parsed.workout_plan, parsed.nutrition_plan, parsed.notes
    );

    // Upload to Supabase Storage
    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    await db.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Save to programs table
    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
    });

    // Send via WhatsApp
    const contextNote = parsed.notes?.substring(0, 150) || `Week ${week_no} program ready!`;
    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      isClient: true,
      templateParams: [client.name || 'there', String(week_no), contextNote],
      media: { url: pdfUrl, filename: `week_${week_no}_program.pdf` },
    });

    // Update whatsapp_sent_at
    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program gen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const profile = [
    `Client: ${client.name || 'N/A'}`,
    `Program: ${client.program}`,
    `Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}`,
    intake?.goal ? `Goal: ${intake.goal}` : '',
    intake?.injuries ? `Injuries/Limitations: ${intake.injuries}` : '',
    intake?.diet_pref ? `Diet preference: ${intake.diet_pref}` : '',
    intake?.schedule ? `Available schedule: ${intake.schedule}` : '',
    intake?.age ? `Age: ${intake.age}` : '',
    intake?.experience ? `Experience: ${intake.experience}` : '',
  ].filter(Boolean).join('\n');

  const checkinData = (checkins || []).map(c => [
    `Week ${c.week_no}:`,
    c.weight ? `  Weight: ${c.weight} kg` : '',
    c.waist ? `  Waist: ${c.waist} cm` : '',
    c.compliance_score ? `  Compliance: ${c.compliance_score}/10` : '',
    c.energy ? `  Energy: ${c.energy}/10` : '',
    c.issues ? `  Issues: ${c.issues}` : '',
    c.next_week_focus ? `  Focus: ${c.next_week_focus}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  return `You are "program_architect" — an expert fitness coach assistant for FitnessByMaddy.

CLIENT PROFILE:
${profile}

RECENT CHECK-INS:
${checkinData || 'No check-ins yet (first week)'}

TASK: Generate a complete Week ${weekNo} program. Output ONLY valid JSON with this exact structure:

{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein": 160,
    "carbs": 220,
    "fats": 70,
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "items": [
          { "food": "Oats with whey", "portion": "60g oats + 1 scoop whey" }
        ]
      }
    ]
  },
  "notes": "Brief 1-2 sentence coaching note for the week"
}

RULES:
- 4-6 training days depending on client schedule and program
- Progressive overload from previous weeks if check-in data available
- Adjust calories/macros based on weight trend and compliance
- NEVER prescribe extreme calorie deficits (minimum 1200 kcal women, 1500 kcal men)
- NEVER recommend banned substances or supplements beyond basics (whey, creatine, multivitamin)
- NEVER make unrealistic claims about timeline or results
- Keep nutrition culturally appropriate (Indian diet friendly for IN market)
- If injuries listed, modify exercises accordingly
- Output ONLY the JSON, no markdown fences or extra text`;
}

function parseProgram(text) {
  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const json = JSON.parse(cleaned);
    if (json.workout_plan && json.nutrition_plan) return json;
    return null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const json = JSON.parse(match[0]);
        if (json.workout_plan && json.nutrition_plan) return json;
      } catch { /* ignore */ }
    }
    return null;
  }
}

function isFlagged(program) {
  const cals = program.nutrition_plan?.calories;
  if (cals && cals < 1200) return true;
  const notes = (program.notes || '').toLowerCase();
  const flagWords = ['steroid', 'dnp', 'clenbuterol', 'ephedra', 'sarm', 'hgh', 'testosterone'];
  if (flagWords.some(w => notes.includes(w))) return true;
  const allText = JSON.stringify(program).toLowerCase();
  if (flagWords.some(w => allText.includes(w))) return true;
  return false;
}
