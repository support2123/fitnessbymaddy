const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const {
    lead_id, name, email, phone, age, goal,
    injuries, diet_pref, schedule, experience
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  if (lead_id) {
    await db.from('leads').update({
      name: name || undefined,
    }).eq('id', lead_id);
  }

  const clientData = {
    lead_id: lead_id || null,
    phone: phone || '',
    name,
    email,
    age: age ? parseInt(age) : null,
    goal,
    injuries,
    diet_pref,
    schedule,
    status: 'active',
  };

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('lead_id', lead_id)
    .single();

  if (existingClient) {
    await db.from('clients').update(clientData).eq('id', existingClient.id);
    return res.status(200).json({ ok: true, client_id: existingClient.id, updated: true });
  }

  const { data: newClient, error } = await db
    .from('clients')
    .insert(clientData)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Failed to save intake', details: error.message });
  }

  return res.status(200).json({ ok: true, client_id: newClient.id });
};
