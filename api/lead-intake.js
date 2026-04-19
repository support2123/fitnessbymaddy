const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      medical_conditions,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
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
        .eq('phone', phone)
        .single();
      lead = data;
    }

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone: phone || 'unknown',
          name,
          source: 'intake_form',
          status: 'qualified',
          program_interest: goal,
        })
        .select()
        .single();
      lead = newLead;
    } else {
      await supabase
        .from('leads')
        .update({
          name: name || lead.name,
          status: lead.status === 'new' ? 'qualified' : lead.status,
          program_interest: goal || lead.program_interest,
          last_msg_at: new Date().toISOString(),
        })
        .eq('id', lead.id);
    }

    const intakeData = {
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      medical_conditions,
      email,
      submitted_at: new Date().toISOString(),
    };

    await supabase
      .from('leads')
      .update({ first_msg: JSON.stringify(intakeData) })
      .eq('id', lead.id);

    return res.status(200).json({ success: true, lead_id: lead.id });

  } catch (err) {
    console.error('Intake form error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
