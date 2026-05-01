const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      diet_pref,
      schedule,
      experience,
      current_weight,
      target_weight,
      medical_conditions,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let leadUpdate = { name };
    if (lead_id) {
      await supabase
        .from('leads')
        .update(leadUpdate)
        .eq('id', lead_id);
    }

    const intakeData = {
      lead_id: lead_id || null,
      phone: phone || null,
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      experience,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      medical_conditions,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('leads')
      .update({
        name,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    if (error) console.error('Lead update error:', error.message);

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
