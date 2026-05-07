const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience, medical_conditions
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    let leadId = lead_id;

    if (lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id, phone')
        .eq('id', lead_id)
        .single();

      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      leadId = lead.id;

      await supabase.from('leads').update({
        name: name || lead.name,
        status: 'qualified'
      }).eq('id', leadId);
    } else {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'intake_form',
        status: 'qualified',
        market: 'GLOBAL'
      }).select().single();
      leadId = newLead.id;
    }

    const intakeData = {
      age, gender, height, weight, goal,
      injuries, diet_pref, schedule, experience, medical_conditions
    };

    await supabase.from('leads').update({
      first_msg: JSON.stringify(intakeData)
    }).eq('id', leadId);

    return res.status(200).json({ status: 'ok', lead_id: leadId });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to process intake' });
  }
};
