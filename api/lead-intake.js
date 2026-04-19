const { supabase } = require('./lib/supabase');
const { maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience_level, medical_conditions
    } = body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const updates = {};
    if (name) updates.name = name;

    let leadQuery;
    if (lead_id) {
      leadQuery = supabase.from('leads').select('*').eq('id', lead_id).single();
    } else {
      const normalized = phone.startsWith('+') ? phone : '+' + phone;
      leadQuery = supabase.from('leads').select('*').eq('phone', normalized).single();
    }

    const { data: lead, error } = await leadQuery;
    if (error || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('leads').update(updates).eq('id', lead.id);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      experience_level, medical_conditions, email,
      submitted_at: new Date().toISOString()
    };

    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `[intake_form] ${JSON.stringify(intakeData)}`,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    return res.status(200).json({
      ok: true,
      message: 'Intake form received',
      lead_id: lead.id
    });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
