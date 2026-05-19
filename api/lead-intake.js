const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const query = lead_id
      ? db.from('leads').select('*').eq('id', lead_id).single()
      : db.from('leads').select('*').eq('phone', phone).single();

    const { data: lead, error } = await query;
    if (error || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;

    const intakeData = { age, gender, height, weight, goal, injuries, diet_pref, schedule, medical_conditions, email };

    await db
      .from('leads')
      .update({ ...updates, last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await db
        .from('clients')
        .update({ name: name || lead.name, email })
        .eq('id', existingClient.id);
    }

    return res.status(200).json({
      ok: true,
      message: 'Intake form received! Your coach will prepare your personalized plan.',
      lead_id: lead.id,
    });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
