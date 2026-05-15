const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, target_weight,
      height, workout_access
    } = req.body || {};

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

    if (!lead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone: phone || 'unknown',
        name,
        source: 'intake_form',
        status: 'new',
        first_msg: `Intake form: ${goal || 'general fitness'}`,
        last_msg_at: new Date().toISOString(),
        market: 'GLOBAL'
      }).select().single();
      lead = newLead;
    }

    if (name && !lead.name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height, workout_access, email
    };

    const { error } = await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
      first_msg: lead.first_msg || JSON.stringify(intakeData).substring(0, 500)
    }).eq('id', lead.id);

    if (error) {
      console.error('Intake update error:', error);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
