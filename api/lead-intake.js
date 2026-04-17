const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      phone, name, email, age, gender, goal, injuries,
      diet_preference, schedule, medical_conditions, current_weight,
      target_weight, experience_level
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({
        name: name || undefined,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);
    }

    const intakeData = {
      phone,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference,
      schedule,
      medical_conditions: medical_conditions || null,
      current_weight: parseFloat(current_weight) || null,
      target_weight: parseFloat(target_weight) || null,
      experience_level,
      submitted_at: new Date().toISOString(),
      lead_id: lead?.id || null
    };

    const { error } = await supabase
      .from('intake_forms')
      .upsert(intakeData, { onConflict: 'phone' });

    if (error) throw error;

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to submit intake form' });
  }
};
