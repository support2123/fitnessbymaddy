const supabase = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;

    await supabase
      .from('leads')
      .update(updates)
      .eq('id', lead_id);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({
          name: name || undefined,
          email: email || undefined,
          age: age ? parseInt(age) : undefined,
          goal: goal || undefined,
          injuries: injuries || undefined,
          diet_pref: diet_pref || undefined,
          schedule: schedule || undefined
        })
        .eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
