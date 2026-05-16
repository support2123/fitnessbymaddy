const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, goal, injuries,
      diet_preference, schedule, medical_conditions, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const supabase = getSupabase();

    let leadId = lead_id;
    if (!leadId && phone) {
      const { data } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();
      if (data) leadId = data.id;
    }

    if (leadId) {
      await supabase
        .from('leads')
        .update({
          name: name || undefined,
          status: 'qualified'
        })
        .eq('id', leadId);
    }

    const { error } = await supabase.from('intake_forms').insert({
      lead_id: leadId,
      name,
      email,
      age: parseInt(age) || null,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      submitted_at: new Date().toISOString()
    });

    if (error) {
      console.error('Intake form insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save form' });
    }

    return res.status(200).json({ success: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
