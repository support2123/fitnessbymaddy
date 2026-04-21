const { supabase } = require('../lib/supabase');
const { corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, medical_conditions, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = {
      age: parseInt(age) || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      email: email || null,
    };

    await supabase.from('leads').update({
      name: name || lead.name,
      first_msg: JSON.stringify(intakeData),
    }).eq('id', lead.id);

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ ok: true, lead_id: lead.id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
