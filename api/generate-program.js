const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');

const RISKY_TERMS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroids', 'sarms', 'ephedrine',
  'lose 10kg in a week', 'crash diet', 'starvation'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return RISKY_TERMS.some(term => lower.includes(term));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .maybeSingle();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, a premium online coaching brand. You create weekly customized workout and nutrition plans.

Rules:
- Plans must be safe, evidence-based, and appropriate for the client's profile
- Never recommend extreme calorie deficits (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements not widely accepted as safe
- Set realistic expectations (0.5-1kg fat loss per week max)
- Consider injuries, medical conditions, and dietary preferences
- Output must be valid JSON`;

    const userPrompt = `Create Week ${week_no} program for this client:

Client Profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Not specified'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Conditions: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No preference'}
- Schedule: ${client.schedule || 'Flexible'}

${recentCheckins && recentCheckins.length > 0 ? `Recent Check-ins:
${recentCheckins.map(c => `- Week ${c.week_no}: Weight ${c.weight || '?'}kg, Waist ${c.waist || '?'}cm, Compliance ${c.compliance_score || '?'}/10, Energy ${c.energy || '?'}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins available.'}

${lastProgram ? `Last Week's Plan Summary:
${lastProgram.notes || 'Standard program'}` : 'First week - create baseline program.'}

Return a JSON object with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min light cardio + dynamic stretches",
        "cooldown": "5 min static stretches"
      }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "LISS", "frequency": "3x/week", "duration": "20-30 min" }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fats_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1 description", "Option 2 description"] }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "weekly_notes": "Brief coaching note for the client",
  "focus_areas": ["Area 1", "Area 2"]
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;

    if (hasSafetyIssue(responseText)) {
      const { sendTemplate: st, notifyMaddy } = require('./_lib/whatsapp');
      await notifyMaddy(
        'Program safety flag',
        `Week ${week_no} for ${client.name || maskPhone(client.phone)} flagged for review`
      );
      return res.status(200).json({ ok: false, reason: 'safety_review_needed' });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: parsed.workout_plan || null,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.weekly_notes || null
    }).select('id').single();

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(week_no),
        parsed.weekly_notes || 'Your new program is ready!'
      ]
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
