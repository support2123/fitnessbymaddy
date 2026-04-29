const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      experience_level, equipment_access,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      program_interest: goal || lead.program_interest,
    }).eq('id', lead_id);

    const { data: client, error } = await db.from('clients').upsert({
      lead_id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      status: 'active',
    }, { onConflict: 'lead_id' }).select().single();

    // Store extended profile as client metadata in a jsonb column or separate table
    // For now, we store key fields inline
    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.json({ success: true, client_id: client?.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
