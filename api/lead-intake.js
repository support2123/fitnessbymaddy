const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, program_interest
    } = req.body;

    if (!lead_id || !name || !phone) {
      return res.status(400).json({ error: 'lead_id, name, and phone are required' });
    }

    const db = getSupabase();

    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {
      name,
      last_msg_at: new Date().toISOString()
    };
    if (program_interest) updates.program_interest = program_interest;

    await db.from('leads').update(updates).eq('id', lead_id);

    const clientData = {
      lead_id,
      phone: lead.phone,
      name,
      email: email || null,
      age: age ? parseInt(age) : null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      program: program_interest || lead.program_interest,
      status: 'active'
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await db.from('clients').update(clientData).eq('id', existingClient.id);
    }

    res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};
