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
      medical_conditions
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
          program_interest: goal
        })
        .select()
        .single();
      lead = newLead;
    }

    if (name) {
      await supabase
        .from('leads')
        .update({
          name,
          status: lead.status === 'new' ? 'qualified' : lead.status
        })
        .eq('id', lead.id);
    }

    const intakeData = {
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      experience_level: experience_level || null,
      current_weight: parseFloat(current_weight) || null,
      target_weight: parseFloat(target_weight) || null,
      medical_conditions: medical_conditions || null,
      email: email || null,
      submitted_at: new Date().toISOString()
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({ name, email })
        .eq('id', existingClient.id);
    }

    await supabase
      .from('leads')
      .update({ intake_data: intakeData })
      .eq('id', lead.id);

    return res.status(200).json({ success: true, lead_id: lead.id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
