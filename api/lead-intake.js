const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, workout_days,
      equipment_access, wake_time, sleep_time, medical_conditions,
      supplements, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let leadId = lead_id;

    if (!leadId && phone) {
      const { data } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) leadId = data[0].id;
    }

    const intakeData = {
      lead_id: leadId,
      name, email, age: parseInt(age) || null, gender, height, weight,
      goal, injuries: injuries || null,
      diet_preference: diet_preference || null,
      workout_days: parseInt(workout_days) || null,
      equipment_access: equipment_access || null,
      wake_time: wake_time || null,
      sleep_time: sleep_time || null,
      medical_conditions: medical_conditions || null,
      supplements: supplements || null,
      submitted_at: new Date().toISOString()
    };

    await supabase.from('intake_forms').insert(intakeData);

    if (leadId) {
      await supabase.from('leads').update({
        name: name || undefined,
        status: 'qualified'
      }).eq('id', leadId);
    }

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
