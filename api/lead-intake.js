const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, goal, injuries,
      diet_pref, schedule, experience
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    const db = getSupabase();

    if (lead_id) {
      await db.from('leads').update({
        name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form submitted successfully'
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to process intake form' });
  }
};
