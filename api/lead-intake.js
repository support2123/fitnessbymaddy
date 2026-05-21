const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      email,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    const query = lead_id
      ? db.from('leads').select('*').eq('id', lead_id).maybeSingle()
      : db.from('leads').select('*').eq('phone', phone).maybeSingle();

    const { data: lead, error } = await query;

    if (error || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db
      .from('leads')
      .update({
        name: name || lead.name,
        status: lead.status === 'new' ? 'qualified' : lead.status,
      })
      .eq('id', lead.id);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .maybeSingle();

    if (existingClient) {
      await db
        .from('clients')
        .update({ name, email, age, goal, injuries, diet_pref, schedule })
        .eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
