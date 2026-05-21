const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, target_weight,
      experience_level
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone.replace(/[^0-9]/g, ''))
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase
        .from('leads')
        .update({ name })
        .eq('id', lead.id);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, target_weight,
      experience_level, email
    };

    const { error } = await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        program_interest: lead.program_interest || goal
      })
      .eq('id', lead.id);

    if (error) {
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
