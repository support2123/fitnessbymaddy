const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
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
      height,
      weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      equipment_access,
      schedule,
      wake_time,
      sleep_time,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const sb = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await sb.from('leads').select('*').eq('id', lead_id).maybeSingle();
      lead = data;
    } else if (phone) {
      const { data } = await sb.from('leads').select('*').eq('phone', phone).maybeSingle();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await sb.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead.id);

    const intakeData = {
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      training_experience,
      equipment_access,
      schedule,
      wake_time,
      sleep_time,
      email,
    };

    const { error: metaError } = await sb
      .from('leads')
      .update({
        name: name || lead.name,
        first_msg: JSON.stringify(intakeData),
      })
      .eq('id', lead.id);

    if (metaError) {
      console.error('Intake save error:', metaError.message);
      return res.status(500).json({ error: 'Failed to save intake data' });
    }

    return res.status(200).json({ success: true, lead_id: lead.id });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
