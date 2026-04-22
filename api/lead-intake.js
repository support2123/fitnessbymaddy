const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      training_schedule,
      current_weight,
      target_weight,
      experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      training_schedule,
      current_weight,
      target_weight,
      experience_level,
      email,
      submitted_at: new Date().toISOString(),
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({ name: name || lead.name, email })
        .eq('id', existingClient.id);
    }

    await supabase
      .from('leads')
      .update({ name: name || lead.name })
      .eq('id', lead_id);

    return res.status(200).json({ success: true, lead_id, intake: intakeData });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
