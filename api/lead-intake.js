const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lead_id, name, email, age, goal, injuries,
    diet_pref, schedule, phone,
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'Missing lead_id or phone' });
  }

  try {
    const supabase = getSupabase();

    let leadId = lead_id;
    if (!leadId && phone) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();
      if (lead) leadId = lead.id;
    }

    if (leadId) {
      await supabase
        .from('leads')
        .update({ name, last_msg_at: new Date().toISOString() })
        .eq('id', leadId);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', leadId)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({
          name, email, age: age ? parseInt(age) : null,
          goal, injuries, diet_pref, schedule,
        })
        .eq('id', existingClient.id);

      return res.status(200).json({ success: true, clientId: existingClient.id, updated: true });
    }

    return res.status(200).json({ success: true, leadId, intake_saved: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
