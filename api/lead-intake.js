const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    if (lead_id) {
      await db.from('leads').update({
        name: name || undefined,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    }

    const clientData = {
      lead_id: lead_id || null,
      phone: phone || '',
      name,
      email,
      age: age ? parseInt(age) : null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      status: 'active'
    };

    if (lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('phone, program_interest')
        .eq('id', lead_id)
        .single();

      if (lead) {
        clientData.phone = lead.phone;
        clientData.program = lead.program_interest || null;
      }
    }

    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('phone', clientData.phone)
      .single();

    if (existing) {
      await db.from('clients').update(clientData).eq('id', existing.id);
      return res.status(200).json({ success: true, client_id: existing.id, updated: true });
    }

    const { data: newClient, error } = await db
      .from('clients')
      .insert(clientData)
      .select('id')
      .single();

    if (error) {
      console.error('Insert client error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true, client_id: newClient.id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
