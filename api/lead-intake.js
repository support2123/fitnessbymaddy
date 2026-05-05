const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    if (lead_id) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
      }).eq('id', existingClient.id);
    } else {
      const lookupPhone = phone || (lead_id ? (await db.from('leads').select('phone').eq('id', lead_id).single()).data?.phone : null);

      await db.from('clients').insert({
        lead_id,
        phone: lookupPhone || 'unknown',
        name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
        status: 'active',
      });
    }

    return res.status(200).json({ success: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
