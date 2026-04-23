const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience, medical,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const updates = {};
    if (name) updates.name = name;

    const { error: leadErr } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', lead_id);

    if (leadErr) {
      console.error('Lead update error:', leadErr.message);
    }

    const intakeData = {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience, medical,
      submitted_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('leads')
      .select('id, phone, market')
      .eq('id', lead_id)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'lead not found' });
    }

    // Store intake data as a JSON note on the lead for now
    // In production, you might want a separate intake_forms table
    await supabase.from('leads')
      .update({
        name: name || undefined,
        first_msg: JSON.stringify(intakeData),
      })
      .eq('id', lead_id);

    return res.json({ ok: true, message: 'Intake submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
