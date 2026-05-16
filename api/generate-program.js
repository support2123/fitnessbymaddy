const { supabase } = require('./lib/supabase');
const { sendFreeform, maskPhone, notifyMaddy } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

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

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
Create weekly training and nutrition plans that are:
- Evidence-based and safe
- Progressive (building on previous weeks)
- Adapted to client feedback and metrics
- Never recommending extreme calorie deficits (<1200 cal), banned substances, or unrealistic timelines

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..."}] }
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 65,
    "meal_timing": "...",
    "hydration": "...",
    "supplements": "...",
    "sample_meals": [{"meal": "Breakfast", "options": ["..."]}]
  },
  "notes": "Brief coaching note for the client",
  "safety_flag": false
}

If ANYTHING seems risky (injury history, extreme requests, medical concerns), set safety_flag to true.`;

    const userPrompt = buildClientPrompt(client, recentCheckins, lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0].text;
    let programData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse program JSON');
      return res.status(500).json({ error: 'AI output parse error' });
    }

    if (programData.safety_flag) {
      await notifyMaddy(
        'Program safety flag',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nNotes: ${programData.notes}`
      );
      return res.status(200).json({ flagged: true, notes: programData.notes });
    }

    const { error: insertError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
      pdf_url: null
    });

    if (insertError) {
      console.error('Program insert error:', insertError);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const summary = `📋 *Week ${week_no} Program Ready!*\n\n` +
      `🏋️ Focus: ${programData.workout_plan.days?.[0]?.focus || 'Full body'}\n` +
      `🥗 Calories: ${programData.nutrition_plan.calories} kcal\n` +
      `💪 Protein: ${programData.nutrition_plan.protein_g}g\n\n` +
      `${programData.notes}\n\n` +
      `Full plan shared in your folder. Questions? Reply here!`;

    await sendFreeform(client.phone, summary);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildClientPrompt(client, checkins, lastProgram, weekNo) {
  let prompt = `Create Week ${weekNo} program for this client:\n\n`;
  prompt += `**Profile:**\n`;
  prompt += `- Name: ${client.name || 'Client'}\n`;
  prompt += `- Program: ${client.program}\n`;
  prompt += `- Age: ${client.age || 'Unknown'}\n`;
  prompt += `- Goal: ${client.goal || 'General fitness'}\n`;
  prompt += `- Injuries/limitations: ${client.injuries || 'None reported'}\n`;
  prompt += `- Diet preference: ${client.diet_pref || 'No restrictions'}\n`;
  prompt += `- Schedule availability: ${client.schedule || 'Flexible'}\n\n`;

  if (checkins && checkins.length > 0) {
    prompt += `**Recent Check-ins:**\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, `;
      prompt += `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10\n`;
      if (c.issues) prompt += `  Issues: ${c.issues}\n`;
    }
    prompt += '\n';
  }

  if (lastProgram) {
    prompt += `**Last week's plan summary:**\n`;
    prompt += `- Calories: ${lastProgram.nutrition_plan?.calories || '?'}\n`;
    prompt += `- Notes: ${lastProgram.notes || 'None'}\n\n`;
  }

  prompt += `Generate a progressive, safe Week ${weekNo} plan. Adjust based on check-in data.`;
  return prompt;
}
