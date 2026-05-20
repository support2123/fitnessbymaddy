const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions, supplements,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    let leadId = lead_id;
    if (!leadId && phone) {
      const { data } = await db.from('leads').select('id').eq('phone', phone).limit(1).single();
      if (data) leadId = data.id;
    }

    if (leadId) {
      await db.from('leads').update({
        name: name || undefined,
        last_msg_at: new Date().toISOString(),
      }).eq('id', leadId);
    }

    const intakeData = {
      lead_id: leadId,
      name, email, phone, age: parseInt(age) || null, gender,
      goal, injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      experience_level: experience_level || null,
      current_weight: parseFloat(current_weight) || null,
      target_weight: parseFloat(target_weight) || null,
      medical_conditions: medical_conditions || null,
      supplements: supplements || null,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await db.from('intake_forms').insert(intakeData);
    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake form' });
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
