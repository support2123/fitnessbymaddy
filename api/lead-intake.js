const { getSupabase } = require('./lib/supabase');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_preference, schedule, program
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const clientData = {
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      program: program || lead.program_interest || 'zoom_trial',
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_preference,
      schedule,
      status: 'active'
    };

    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existing) {
      await db.from('clients').update(clientData).eq('id', existing.id);
      return res.status(200).json({ success: true, client_id: existing.id, updated: true });
    }

    const { data: client, error } = await db
      .from('clients')
      .insert(clientData)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
