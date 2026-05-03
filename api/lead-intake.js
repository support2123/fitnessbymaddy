const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      wake_time, sleep_time, current_weight, height, target_weight,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    let leadId = lead_id;
    if (!leadId && phone) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .single();
      leadId = lead?.id;
    }

    if (leadId) {
      await db.from('leads').update({
        name: name || undefined,
        status: 'qualified',
        last_msg_at: new Date().toISOString(),
      }).eq('id', leadId);
    }

    const intakeData = {
      lead_id: leadId,
      name, email, phone, age: parseInt(age) || null, gender,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      wake_time, sleep_time,
      current_weight: parseFloat(current_weight) || null,
      height: parseFloat(height) || null,
      target_weight: parseFloat(target_weight) || null,
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await db.from('intake_forms').insert(intakeData).select().single();

    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Failed to save' });
    }

    return res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
