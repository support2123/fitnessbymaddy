const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, age, phone, email,
      goal, injuries, diet_pref, schedule, experience,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getClient();

    // Verify lead exists
    const { data: lead } = await db
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Save intake submission
    await db.from('intake_submissions').insert({
      lead_id,
      name,
      age: age ? parseInt(age) : null,
      phone: phone || lead.phone,
      email,
      goal,
      injuries,
      diet_pref,
      schedule,
      experience,
    });

    // Update lead with name if provided
    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    return res.json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
