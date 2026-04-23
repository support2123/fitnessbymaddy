const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, current_weight, target_weight,
      medical_conditions, supplements
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    if (Object.keys(updates).length > 0) {
      await supabase.from('leads').update(updates).eq('id', lead_id);
    }

    const intakeData = {
      lead_id,
      name: name || lead.name,
      email,
      phone: phone || lead.phone,
      age: age ? parseInt(age, 10) : null,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      experience,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      medical_conditions,
      supplements,
      submitted_at: new Date().toISOString()
    };

    const { error: insertErr } = await supabase
      .from('leads')
      .update({
        name: intakeData.name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    if (insertErr) {
      console.error('Intake update error:', insertErr.message);
    }

    return res.status(200).json({ ok: true, message: 'Intake form received' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
