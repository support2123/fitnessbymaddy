const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, email, age, goal, injuries,
    diet_pref, schedule, phone, form_type,
    preferred_date, preferred_time, reason,
  } = req.body;

  if (form_type === 'reschedule') {
    return handleReschedule(req, res, { phone, preferred_date, preferred_time, reason });
  }

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  let lead;
  if (lead_id) {
    const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
    lead = data;
  } else {
    const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
    lead = data;
  }

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  if (name) {
    await supabase.from('leads').update({ name }).eq('id', lead.id);
  }

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('lead_id', lead.id)
    .single();

  if (existingClient) {
    await supabase.from('clients').update({
      name: name || undefined,
      email: email || undefined,
      age: age || undefined,
      goal: goal || undefined,
      injuries: injuries || undefined,
      diet_pref: diet_pref || undefined,
      schedule: schedule || undefined,
    }).eq('id', existingClient.id);

    return res.status(200).json({ status: 'updated', client_id: existingClient.id });
  }

  const { data: newClient, error } = await supabase.from('clients').insert({
    lead_id: lead.id,
    phone: lead.phone,
    name: name || lead.name,
    email,
    program: lead.program_interest,
    age,
    goal,
    injuries,
    diet_pref,
    schedule,
    status: 'active',
  }).select().single();

  if (error) {
    console.error('Client insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }

  return res.status(200).json({ status: 'created', client_id: newClient.id });
};

async function handleReschedule(req, res, { phone, preferred_date, preferred_time, reason }) {
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, phone')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Active client not found for this phone number' });
  }

  const { notifyMaddy } = require('./lib/whatsapp');
  await notifyMaddy(
    'Session Reschedule Request',
    `Client: ${client.name || phone}\nNew Date: ${preferred_date}\nTime: ${preferred_time}\nReason: ${reason || 'Not provided'}`
  );

  return res.status(200).json({ status: 'reschedule_requested' });
}
