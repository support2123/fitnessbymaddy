const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_schedule,
      experience_level,
      supplements,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).maybeSingle();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).maybeSingle();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead.id);

    const { error } = await supabase.from('intake_forms').insert({
      lead_id: lead.id,
      name,
      email,
      phone: lead.phone,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      workout_schedule,
      experience_level,
      supplements: supplements || null,
      submitted_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Intake form save error:', error.message);
      return res.status(500).json({ error: 'Failed to save form' });
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
