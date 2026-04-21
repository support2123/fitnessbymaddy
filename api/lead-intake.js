const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, email, age, gender, goal, injuries, diet_pref, schedule, experience, medical_conditions } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id required' });
    }

    const db = getSupabase();

    const { data: lead } = await db.from('leads').select('id').eq('id', lead_id).single();
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('intake_submissions').insert({
      lead_id,
      data: {
        name, email, age, gender, goal, injuries,
        diet_pref, schedule, experience, medical_conditions
      }
    });

    const updates = {};
    if (name) updates.name = name;
    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
