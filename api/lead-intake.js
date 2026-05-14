const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

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
      medical_conditions,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    let leadId = lead_id;

    if (lead_id) {
      const { error: updateErr } = await supabase
        .from('leads')
        .update({
          name: name || undefined,
          last_msg_at: new Date().toISOString(),
        })
        .eq('id', lead_id);

      if (updateErr) {
        return res.status(400).json({ error: 'Invalid lead_id' });
      }
    } else {
      const { data: newLead, error: insertErr } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'intake_form',
          status: 'qualified',
        })
        .select()
        .single();

      if (insertErr) {
        return res.status(500).json({ error: 'Failed to create lead' });
      }
      leadId = newLead.id;
    }

    const intakeData = {
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      medical_conditions,
      email,
    };

    const { error: metaErr } = await supabase
      .from('leads')
      .update({
        first_msg: JSON.stringify(intakeData),
        name: name || undefined,
      })
      .eq('id', leadId);

    if (metaErr) {
      console.error('Failed to save intake metadata:', metaErr.message);
    }

    return res.status(200).json({ success: true, lead_id: leadId });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
