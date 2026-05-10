const { supabase } = require('../lib/supabase');

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
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, medical_conditions, notes
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    if (Object.keys(updates).length > 0) {
      await supabase.from('leads').update(updates).eq('id', lead_id);
    }

    const intakeData = {
      lead_id, name, email, phone: phone || lead.phone,
      age, gender, goal, injuries, diet_preference,
      schedule, experience_level, medical_conditions, notes,
      submitted_at: new Date().toISOString()
    };

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1);

    if (existing && existing.length > 0) {
      await supabase.from('clients').update({
        name: name || undefined,
        email: email || undefined
      }).eq('lead_id', lead_id);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.json({ success: true, message: 'Intake form received' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
