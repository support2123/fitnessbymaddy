const supabase = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
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
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      medical_conditions,
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
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
      })
      .eq('id', lead.id);

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
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .limit(1)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({ name: name || lead.name, email })
        .eq('id', existingClient.id);
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form submitted successfully',
      lead_id: lead.id,
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
