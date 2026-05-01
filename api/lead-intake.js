const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      current_weight, height, experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    // Verify lead exists
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with form data
    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    // Store intake data as a client record (pre-conversion)
    // This gets fully activated when Exly webhook fires
    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    const intakeData = {
      lead_id,
      phone: phone || lead.phone,
      name: name || lead.name,
      email,
      status: 'active',
    };

    if (existing) {
      await db.from('clients').update(intakeData).eq('id', existing.id);
    } else {
      intakeData.status = 'paused'; // Not yet paid
      await db.from('clients').insert(intakeData);
    }

    // Return success — the form will show a confirmation
    return res.status(200).json({
      success: true,
      message: 'Intake form received. Complete your purchase to start your program!',
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
