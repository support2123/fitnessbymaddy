const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy, maskPhone } = require('../lib/whatsapp');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'lose 20 pounds in'
];

function checkSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads(name, market)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const clientProfile = {
      name: client.name || 'Client',
      program: client.program,
      week: week_no,
      intake: client.intake_data || {},
      recent_checkins: (recentCheckins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues
      }))
    };

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand.
You create weekly personalized workout and nutrition plans based on client data.

RULES:
- Programs must be safe, evidence-based, and realistic
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend any banned substances, supplements with safety concerns, or extreme protocols
- Adjust intensity based on compliance scores and reported energy levels
- If client reports pain or medical issues, recommend consulting a doctor and reduce intensity
- Use progressive overload principles
- Include both workout plan and nutrition guidelines

Output valid JSON with these keys:
{
  "workout_plan": { "days": [...], "notes": "..." },
  "nutrition_plan": { "calories": ..., "protein_g": ..., "meals": [...], "notes": "..." },
  "weekly_note": "A 1-2 sentence personalized note for the client"
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Generate week ${week_no} program for this client:\n${JSON.stringify(clientProfile, null, 2)}`
      }]
    });

    const responseText = message.content[0].text;

    if (checkSafety(responseText)) {
      await notifyMaddy(
        'Program safety flag',
        `Client ${maskPhone(client.phone)}, Week ${week_no} — AI output flagged for review. Program NOT sent.`
      );
      return res.status(200).json({ flagged: true, message: 'Flagged for manual review' });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = { workout_plan: {}, nutrition_plan: {}, weekly_note: responseText.slice(0, 200) };
    }

    const { error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || {},
      nutrition_plan: parsed.nutrition_plan || {},
      notes: parsed.weekly_note || '',
      pdf_url: null
    });

    if (error) throw error;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.weekly_note || 'Your new program is ready!'
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      success: true,
      week_no,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
