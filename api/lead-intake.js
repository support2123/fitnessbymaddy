const supabase = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, target_weight, height,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    // Find or update lead
    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else if (phone) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with name
    await supabase
      .from('leads')
      .update({ name: name || lead.name })
      .eq('id', lead.id);

    // Store intake data as a client profile (pre-conversion)
    // This data will be used when the client converts
    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, target_weight, height, email,
    };

    // Store in lead's first_msg as JSON for now (used during conversion)
    await supabase
      .from('leads')
      .update({
        first_msg: JSON.stringify(intakeData),
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
