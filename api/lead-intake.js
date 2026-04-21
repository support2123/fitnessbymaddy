const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    // Find the lead
    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with name if provided
    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    // Store intake data on the clients table (pre-create if not exists)
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    const clientData = {
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      program: lead.program_interest || 'zoom_trial',
      status: 'active'
    };

    if (existingClient) {
      await supabase.from('clients').update(clientData).eq('id', existingClient.id);
    } else {
      // Pre-create client record (will be finalized on payment)
      clientData.status = 'paused'; // Not active until payment confirmed
      await supabase.from('clients').insert(clientData);
    }

    return res.status(200).json({ success: true, message: 'Intake form saved' });

  } catch (err) {
    console.error('Intake form error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
