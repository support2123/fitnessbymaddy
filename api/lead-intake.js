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
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_days, workout_location, wake_time, sleep_time,
      supplements, notes
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead = null;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else if (phone) {
      const { data } = await supabase.from('leads')
        .select('*').eq('phone', phone)
        .order('created_at', { ascending: false }).limit(1).single();
      lead = data;
    }

    if (lead) {
      await supabase.from('leads').update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      medical_conditions, diet_preference, workout_days,
      workout_location, wake_time, sleep_time, supplements, notes
    };

    const { data: client, error } = await supabase.from('clients').upsert({
      lead_id: lead?.id || null,
      phone: phone || lead?.phone,
      name: name || lead?.name,
      email: email || null,
      program: lead?.program_interest || '6wk_gym',
      status: 'active'
    }, { onConflict: 'phone', ignoreDuplicates: false }).select().single();

    if (error && error.code !== '23505') {
      console.error('Intake insert error:', error.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form received! Maddy\'s team will reach out shortly.',
      clientId: client?.id
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
