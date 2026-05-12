const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, medications, experience_level
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
    }

    const updates = { name };
    if (lead_id) {
      await supabase
        .from('leads')
        .update(updates)
        .eq('id', lead_id);
    }

    const { data, error } = await supabase
      .from('clients')
      .upsert({
        lead_id,
        phone: phone || '',
        name,
        email,
        program: 'zoom_trial',
        status: 'active',
        metadata: {
          age, gender, goal, injuries, diet_pref,
          schedule, medical_conditions, medications,
          experience_level
        }
      }, { onConflict: 'lead_id' })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ ok: true, client_id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to process intake' });
  }
};
