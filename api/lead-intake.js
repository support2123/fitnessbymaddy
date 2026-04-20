const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, workout_schedule,
    medical_conditions, experience_level
  } = req.body;

  if (!lead_id) {
    return res.status(400).json({ error: 'lead_id is required' });
  }

  try {
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      age: age || null,
      gender: gender || null,
      height: height || null,
      weight: weight || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      workout_schedule: workout_schedule || null,
      medical_conditions: medical_conditions || null,
      experience_level: experience_level || null,
      email: email || null
    };

    const { error: updateErr } = await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    if (updateErr) {
      console.error('Lead update error:', updateErr.message);
    }

    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `Intake form submitted: ${JSON.stringify(intakeData)}`,
      status: 'received'
    });

    return res.status(200).json({ ok: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
