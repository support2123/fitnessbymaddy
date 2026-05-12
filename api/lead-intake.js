const { getSupabase } = require('../lib/supabase');
const { normalizePhone } = require('../lib/phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      medical_conditions, current_fitness_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const updates = {};
    if (name) updates.name = name;

    const { error } = await db
      .from('leads')
      .update(updates)
      .eq('id', lead_id);

    if (error) return res.status(400).json({ error: error.message });

    const { data: lead } = await db
      .from('leads')
      .select('phone')
      .eq('id', lead_id)
      .single();

    if (lead?.phone || phone) {
      const { data: existingClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', normalizePhone(lead?.phone || phone))
        .limit(1)
        .single();

      if (existingClient) {
        await db.from('clients').update({
          name,
          email,
        }).eq('id', existingClient.id);
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
