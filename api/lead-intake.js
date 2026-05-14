const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender, goal, injuries,
      diet_pref, schedule, experience, current_weight, target_weight,
      medical_conditions
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule, experience,
      current_weight, target_weight, medical_conditions, email
    };
    updates.first_msg = JSON.stringify(intakeData);

    await supabase
      .from('leads')
      .update(updates)
      .eq('id', lead_id);

    if (phone) {
      await supabase
        .from('leads')
        .update({ phone })
        .eq('id', lead_id);
    }

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
