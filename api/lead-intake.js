const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    // Update lead with intake data
    const updateData = {};
    if (name) updateData.name = name;

    if (lead_id) {
      await db.from('leads').update(updateData).eq('id', lead_id);
    } else if (phone) {
      await db.from('leads').update(updateData).eq('phone', phone);
    }

    // If client exists, update their profile too
    const phoneToMatch = phone;
    if (phoneToMatch) {
      await db.from('clients').update({
        name: name || undefined,
        email: email || undefined,
        age: age || undefined,
        goal: goal || undefined,
        injuries: injuries || undefined,
        diet_pref: diet_pref || undefined,
        schedule: schedule || undefined
      }).eq('phone', phoneToMatch);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[Lead Intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
