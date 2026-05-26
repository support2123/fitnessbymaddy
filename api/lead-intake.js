const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      medical_conditions
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      phone: phone || lead.phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      medical_conditions,
      submitted_at: new Date().toISOString()
    };

    const { error: storageError } = await supabase
      .storage
      .from('intake-forms')
      .upload(
        `${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageError) {
      console.error('Storage upload failed:', storageError.message);
    }

    if (medical_conditions && medical_conditions.trim()) {
      const { notifyMaddy } = require('./lib/escalation');
      await notifyMaddy('Medical condition reported on intake form', {
        phone: phone || lead.phone,
        clientName: name,
        message: `Medical conditions: ${medical_conditions}`
      });
    }

    return res.status(200).json({ ok: true, message: 'Intake form received' });
  } catch (error) {
    console.error('Intake error:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
