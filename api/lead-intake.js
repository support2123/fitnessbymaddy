const { getClient } = require('../lib/supabase');
const { corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  const db = getClient();

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const cleanPhone = phone.replace(/\D/g, '');
      const { data } = await db.from('leads').select('*').eq('phone', cleanPhone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .limit(1)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name: name || existingClient.name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
      }).eq('id', existingClient.id);

      return res.status(200).json({ ok: true, client_id: existingClient.id, updated: true });
    }

    return res.status(200).json({
      ok: true,
      lead_id: lead.id,
      message: 'Intake saved. Client record will be created on payment.',
    });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
