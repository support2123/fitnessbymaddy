const { supabase } = require('./lib/supabase');
const { needsEscalation } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');
const { cors, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, medical_conditions } = body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name: name || '',
      email: email || '',
      age: parseInt(age) || null,
      goal: goal || '',
      injuries: injuries || '',
      diet_pref: diet_pref || '',
      schedule: schedule || '',
      medical_conditions: medical_conditions || '',
      submitted_at: new Date().toISOString(),
    };

    await supabase.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });

    const allText = [goal, injuries, medical_conditions].join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy('Medical/injury flag in intake form', {
        phone: lead.phone,
        name,
        message: allText,
      });
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
