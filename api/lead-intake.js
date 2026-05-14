const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience_level, medical_conditions, current_weight,
      target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;
    if (email || phone || age || gender || goal || injuries || diet_pref ||
        schedule || experience_level || medical_conditions || current_weight ||
        target_weight || height) {
      updates.intake_data = {
        email, age, gender, goal, injuries, diet_pref, schedule,
        experience_level, medical_conditions, current_weight, target_weight, height
      };
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    // Store the full intake in a metadata column or just update lead name/email
    // For now we store the intake data on the lead via the messages audit trail
    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `[INTAKE FORM] ${JSON.stringify(req.body)}`,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    return res.status(200).json({ ok: true, message: 'Intake received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
