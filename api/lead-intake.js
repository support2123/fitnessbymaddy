const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body;
    var lead_id = body.lead_id;
    var name = body.name;
    var email = body.email;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
    }

    var db = getClient();

    var { error } = await db.from('leads').update({
      name: name,
      intake_data: {
        email: email,
        age: body.age || null,
        goal: body.goal || null,
        injuries: body.injuries || null,
        diet_pref: body.diet_pref || null,
        schedule: body.schedule || null,
        experience: body.experience || null,
        equipment: body.equipment || null
      }
    }).eq('id', lead_id);

    if (error) throw error;

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
