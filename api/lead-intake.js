const { supabase } = require('../lib/supabase');

// Handles intake form submission from /intake.html
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions, supplements
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    // Find or update the lead
    let leadQuery;
    if (lead_id) {
      leadQuery = supabase.from('leads').select('*').eq('id', lead_id).single();
    } else {
      leadQuery = supabase.from('leads').select('*').eq('phone', phone).single();
    }

    const { data: lead, error: leadErr } = await leadQuery;
    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with intake info
    await supabase.from('leads').update({
      name: name || lead.name,
      program_interest: goal || lead.program_interest
    }).eq('id', lead.id);

    // Store full intake data as a client record (pre-conversion)
    // or update existing client if already converted
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    const clientData = {
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email
    };

    if (existingClient) {
      await supabase.from('clients').update(clientData).eq('id', existingClient.id);
    }

    // Store extended intake data in lead metadata via a simple approach:
    // We'll add intake fields to a jsonb column, or just track it in messages
    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify({
        type: 'intake_form', age, gender, goal, injuries,
        diet_pref, schedule, experience, medical_conditions, supplements
      }),
      template_name: 'intake_form',
      status: 'received'
    });

    return res.status(200).json({ ok: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
