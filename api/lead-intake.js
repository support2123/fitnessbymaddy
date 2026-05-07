const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, program
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

    if (lead) {
      await db.from('leads').update({
        name: name || lead.name,
        program_interest: program || lead.program_interest
      }).eq('id', lead.id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', lead?.phone || phone)
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      await db.from('clients').update({
        name, email, age: age ? parseInt(age) : null,
        goal, injuries, diet_pref, schedule
      }).eq('id', existingClient[0].id);

      return res.status(200).json({ success: true, action: 'updated', clientId: existingClient[0].id });
    }

    return res.status(200).json({
      success: true,
      action: 'intake_saved',
      message: 'Intake form received. Profile will be created upon payment.'
    });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
