const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, current_weight, target_weight, height
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    // Find the lead
    let lead;
    if (lead_id) {
      const { data } = await supabase()
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else {
      const normalized = phone.startsWith('+') ? phone : `+${phone}`;
      const { data } = await supabase()
        .from('leads')
        .select('*')
        .eq('phone', normalized)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with intake info
    await supabase()
      .from('leads')
      .update({
        name: name || lead.name,
        status: lead.status === 'new' ? 'qualified' : lead.status
      })
      .eq('id', lead.id);

    // Store intake data as a note on the lead (we'll use this when creating the client)
    // For now, store in the messages table as an audit record
    await supabase().from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify({
        type: 'intake_form',
        name, email, age, gender, goal, injuries,
        diet_pref, schedule, experience,
        current_weight, target_weight, height
      }),
      template_name: 'intake_form_submission'
    });

    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
