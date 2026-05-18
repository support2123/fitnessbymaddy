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
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    const intakeData = {
      lead_id,
      name, email, phone: phone || lead.phone,
      age: age ? parseInt(age) : null,
      gender, goal, injuries, diet_pref,
      schedule, experience, medical_conditions,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      height: height ? parseFloat(height) : null,
      submitted_at: new Date().toISOString()
    };

    const { error: storageError } = await db.storage
      .from('intake-forms')
      .upload(
        `${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageError) {
      console.error('Storage upload error:', storageError.message);
    }

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
