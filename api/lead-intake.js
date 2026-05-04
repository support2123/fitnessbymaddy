const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, schedule, experience,
    medical_conditions, phone
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

  const updates = {};
  if (name) updates.name = name;

  await supabase
    .from('leads')
    .update(updates)
    .eq('id', lead.id);

  const { error } = await supabase
    .from('intake_forms')
    .upsert({
      lead_id: lead.id,
      name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      experience, medical_conditions,
      submitted_at: new Date().toISOString()
    }, { onConflict: 'lead_id' });

  if (error) {
    return res.status(500).json({ error: 'Failed to save intake' });
  }

  return res.status(200).json({ success: true, message: 'Intake saved' });
};
