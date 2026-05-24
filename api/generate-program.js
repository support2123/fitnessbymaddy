const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Get client info
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Build prompt for Claude
    const prompt = buildProgramPrompt(client, checkins || [], week_no);

    // Call Claude API
    const anthropic = await getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const programText = response.content[0].text;
    let programData;

    try {
      programData = JSON.parse(programText);
    } catch {
      // If Claude didn't return pure JSON, extract it
      const jsonMatch = programText.match(/\{[\s\S]*\}/);
      programData = jsonMatch ? JSON.parse(jsonMatch[0]) : { workout_plan: programText, nutrition_plan: '' };
    }

    // Safety check
    if (isSafeProgram(programData)) {
      // Store in programs table
      const { data: program, error } = await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || programData,
        nutrition_plan: programData.nutrition_plan || null,
        notes: programData.notes || null
      }).select().single();

      if (error) throw error;

      // Send via WhatsApp
      const market = client.market || 'IN';
      const note = market === 'IN'
        ? `Week ${week_no} ka plan ready hai! Check karo aur questions ho toh batao.`
        : `Your Week ${week_no} plan is ready! Check it out and let me know if you have questions.`;

      await sendWhatsApp(client.phone, 'weekly_program', {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(week_no), note]
      });

      await supabase.from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', program.id);

      return res.status(200).json({ success: true, program_id: program.id });
    } else {
      // Flag for Maddy review
      const { escalateToMaddy } = require('./lib/escalation');
      const { maskPhone } = require('./lib/whatsapp');
      await escalateToMaddy('Program safety flag - needs review', {
        phone: maskPhone(client.phone),
        message: `Week ${week_no} program for ${client.name} flagged for safety review`
      });

      // Store but don't send
      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || programData,
        nutrition_plan: programData.nutrition_plan || null,
        notes: 'FLAGGED: Needs Maddy review before sending'
      });

      return res.status(200).json({ success: true, flagged: true, reason: 'Safety review required' });
    }
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function getAnthropicClient() {
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

function buildProgramPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a program architect for an elite online fitness coaching business. Generate a weekly training and nutrition plan.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Goal: ${client.goal || 'General fitness'}
- Age: ${client.age || 'Not specified'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Standard'}
- Current Week: ${weekNo}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
${lastCheckin.next_week_focus ? `- Focus area: ${lastCheckin.next_week_focus}` : ''}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10` : ''}

RULES:
- Never prescribe fewer than 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme supplementation
- Consider injuries and limitations
- Progressive overload principle week-over-week
- If compliance was low, simplify rather than intensify
- If energy was low, check recovery recommendations

Return ONLY valid JSON in this format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [{"name": "...", "sets": 3, "reps": "8-10", "rest": "90s"}] }
    ],
    "cardio": "...",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 70,
    "meal_timing": "...",
    "notes": "..."
  },
  "notes": "Brief coaching note for the client"
}`;
}

function isSafeProgram(data) {
  const plan = data.nutrition_plan || {};
  const calories = plan.calories || plan.daily_calories;

  // Flag extremely low calories
  if (calories && calories < 1200) return false;

  // Check for banned substance mentions
  const text = JSON.stringify(data).toLowerCase();
  const banned = ['steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra', 'hgh'];
  if (banned.some(b => text.includes(b))) return false;

  // Flag unrealistic timelines
  if (text.includes('lose 10kg in 1 week') || text.includes('lose 20 pounds in')) return false;

  return true;
}
