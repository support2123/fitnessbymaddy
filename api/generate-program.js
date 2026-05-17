const { supabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');

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

    const prompt = buildProgramPrompt(client, recentCheckins || [], week_no);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const programContent = claudeData.content?.[0]?.text;

    if (!programContent) {
      throw new Error('Empty response from Claude API');
    }

    let parsed;
    try {
      const jsonMatch = programContent.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Failed to parse program JSON');
    }

    if (hasSafetyIssues(parsed)) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client.name} (${client.phone})\nWeek: ${week_no}\nReason: Potential safety concern in generated program`
      );
      return res.status(200).json({ flagged: true, message: 'Program flagged for manual review' });
    }

    const pdfUrl = `clients/${client_id}/week_${week_no}.json`;
    await supabase.storage
      .from('programs')
      .upload(pdfUrl, JSON.stringify(parsed, null, 2), {
        contentType: 'application/json',
        upsert: true
      });

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes
    });

    const contextNote = parsed.notes || `Week ${week_no} program ready!`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: `💪 Week ${week_no} Program Ready!\n\n${contextNote}\n\nYour full workout & nutrition plan has been updated. Let's crush it this week!`
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildProgramPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let context = `You are a certified personal trainer creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

`;

  if (lastCheckin) {
    context += `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'Not reported'} kg
- Waist: ${lastCheckin.waist || 'Not reported'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None reported'}
`;
  }

  if (prevCheckin) {
    context += `\nPREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'Not reported'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
`;
  }

  context += `
INSTRUCTIONS:
- Create a progressive, science-based program for this week
- Include both workout and nutrition plans
- Be specific with sets, reps, rest periods
- Adjust based on compliance and energy levels
- NEVER recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- NEVER recommend any banned substances or supplements
- NEVER promise unrealistic timelines (more than 1kg/week fat loss)
- Keep the program sustainable and injury-safe

Return ONLY a JSON object with this exact structure:
{
  "workout_plan": {
    "days": [
      {"day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}]},
      ...
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "hydration": "...",
    "notes": "..."
  },
  "notes": "One-liner context for the client about this week's focus"
}`;

  return context;
}

function hasSafetyIssues(program) {
  if (!program) return true;

  const nutrition = program.nutrition_plan;
  if (nutrition) {
    if (nutrition.calories && nutrition.calories < 1200) return true;
    if (nutrition.calories && nutrition.calories > 4000) return true;
  }

  const notes = JSON.stringify(program).toLowerCase();
  const banned = ['steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra', 'hgh injection'];
  if (banned.some(b => notes.includes(b))) return true;

  return false;
}
