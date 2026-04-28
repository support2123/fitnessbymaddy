const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, goal,
      injuries, diet_pref, schedule, experience,
      current_weight, target_weight, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const intakeData = {
      name, email, age: parseInt(age) || null, gender, goal,
      injuries: injuries || 'None',
      diet_pref: diet_pref || 'No preference',
      schedule: schedule || 'Flexible',
      experience: experience || 'Beginner',
      current_weight, target_weight,
      submitted_at: new Date().toISOString()
    };

    await supabase.from('leads').update({
      first_msg: JSON.stringify(intakeData)
    }).eq('id', lead.id);

    return res.json({ ok: true, lead_id: lead.id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
