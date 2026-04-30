const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const updateData = {};
    if (name) updateData.name = name;

    if (lead_id) {
      await supabase
        .from('leads')
        .update(updateData)
        .eq('id', lead_id);
    } else if (phone) {
      await supabase
        .from('leads')
        .update(updateData)
        .eq('phone', phone);
    }

    const intakeRecord = {
      lead_id: lead_id || null,
      name,
      email,
      age: age ? parseInt(age, 10) : null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      phone: phone || null,
      submitted_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (existing && email) {
      await supabase
        .from('leads')
        .update({ name })
        .eq('id', lead_id);
    }

    return res.status(200).json({ success: true, message: 'Intake received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
