const { getSupabase } = require('./lib/supabase');
const { cors, parseBody, checkEscalation } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = await parseBody(req);
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, target_weight,
      experience_level
    } = body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const escalationKeyword = checkEscalation(allText);
    if (escalationKeyword) {
      await escalateToMaddy(lead.phone, `Intake form: ${escalationKeyword}`, allText);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, target_weight,
      experience_level, submitted_at: new Date().toISOString()
    };

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `Intake form submitted: ${JSON.stringify(intakeData)}`
    });

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
