const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const db = getSupabase();

    if (lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();

      if (!lead) return res.status(404).json({ error: 'Lead not found' });

      await db.from('leads').update({ name: name || lead.name }).eq('id', lead_id);
    }

    const clientData = {
      lead_id: lead_id || null,
      phone: phone || null,
      name,
      email,
      age: age ? parseInt(age, 10) : null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      status: 'active',
    };

    if (lead_id) {
      const { data: existingClient } = await db
        .from('clients')
        .select('id')
        .eq('lead_id', lead_id)
        .single();

      if (existingClient) {
        await db.from('clients').update(clientData).eq('id', existingClient.id);
        return res.json({ success: true, client_id: existingClient.id, updated: true });
      }
    }

    const { data: lead } = lead_id
      ? await db.from('leads').select('phone').eq('id', lead_id).single()
      : { data: null };

    clientData.phone = clientData.phone || lead?.phone;

    const { data: newClient, error } = await db
      .from('clients')
      .insert(clientData)
      .select('id')
      .single();

    if (error) throw error;

    return res.json({ success: true, client_id: newClient.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to process intake' });
  }
};
