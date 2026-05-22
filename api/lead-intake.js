const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      training_experience,
      schedule,
      equipment_access,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'missing lead_id' });

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    const intakeData = {
      age,
      gender,
      height,
      weight,
      goal,
      injuries: injuries || 'none',
      medical_conditions: medical_conditions || 'none',
      diet_preference: diet_preference || 'no preference',
      training_experience: training_experience || 'beginner',
      schedule: schedule || 'flexible',
      equipment_access: equipment_access || 'gym',
      email: email || '',
      phone: phone || lead.phone,
      submitted_at: new Date().toISOString(),
    };

    const bucketPath = `intake/${lead_id}.json`;
    await supabase.storage
      .from('client-data')
      .upload(bucketPath, JSON.stringify(intakeData, null, 2), {
        contentType: 'application/json',
        upsert: true,
      });

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};
