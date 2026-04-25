const { getSupabase } = require('./_lib/supabase');
const { handleCors } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, goal, injuries,
      diet_pref, schedule, experience, equipment, medical
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'lead not found' });

    if (name || email) {
      await db.from('leads')
        .update({
          name: name || lead.name,
          last_msg_at: new Date().toISOString()
        })
        .eq('id', lead_id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await db.from('clients')
        .update({
          name: name || undefined,
          email: email || undefined,
          age: age ? parseInt(age) : undefined,
          goal: goal || undefined,
          injuries: [injuries, medical].filter(Boolean).join('; ') || undefined,
          diet_pref: diet_pref || undefined,
          schedule: schedule || undefined
        })
        .eq('id', existingClient.id);

      return res.status(200).json({ ok: true, action: 'updated', client_id: existingClient.id });
    }

    return res.status(200).json({
      ok: true,
      action: 'intake_saved',
      message: 'Intake form received. Client record will be created on payment.'
    });
  } catch (err) {
    console.error('[Intake] Error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
