const { getSupabase } = require('./lib/supabase');
const { cors } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      phone, name, email, age, goal, injuries,
      diet_pref, schedule, program,
    } = req.body;

    if (!phone || !name) {
      return res.status(400).json({ error: 'phone and name required' });
    }

    const db = getSupabase();

    await db.from('leads').upsert(
      {
        phone,
        name,
        program_interest: program || null,
        last_msg_at: new Date().toISOString(),
      },
      { onConflict: 'phone' }
    );

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
        schedule,
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
