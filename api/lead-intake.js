const { getSupabase } = require('./_lib/supabase');
const { corsHeaders } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id,
      name,
      email,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    const query = lead_id
      ? db.from('leads').select('*').eq('id', lead_id).single()
      : db.from('leads').select('*').eq('phone', phone).single();

    const { data: lead, error } = await query;
    if (error || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db
      .from('leads')
      .update({ name: name || lead.name })
      .eq('id', lead.id);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await db
        .from('clients')
        .update({ name, email, age, goal, injuries, diet_pref, schedule })
        .eq('id', existingClient.id);

      return res.status(200).json({ success: true, client_id: existingClient.id, updated: true });
    }

    return res.status(200).json({
      success: true,
      lead_id: lead.id,
      message: 'Intake saved. Client record will be created on payment.',
      intake: { name, email, age, goal, injuries, diet_pref, schedule },
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
