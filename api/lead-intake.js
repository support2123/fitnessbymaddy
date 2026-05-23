const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, email, age, goal, injuries,
    diet_pref, schedule, phone
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const db = getSupabase();

  try {
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      lead_id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      age: age ? parseInt(age, 10) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      program: lead.program_interest,
      status: 'active'
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await db.from('clients').update(intakeData).eq('id', existingClient.id);
    } else {
      await db.from('clients').insert(intakeData);
    }

    return res.json({ success: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
