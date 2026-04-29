const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, training_experience,
      medical_conditions,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, phone, market')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .maybeSingle();

    if (existingClient) {
      await db.from('clients').update({
        name, email, age: parseInt(age) || null,
        goal, injuries, diet_pref, schedule,
      }).eq('id', existingClient.id);
    }

    if (medical_conditions && medical_conditions.trim()) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        phone || lead.phone,
        'Medical condition reported in intake form',
        `${name}: ${medical_conditions}`
      );
    }

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('[INTAKE ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
