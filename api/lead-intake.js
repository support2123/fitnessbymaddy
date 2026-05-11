const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions, equipment_access,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    if (lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();

      if (lead) {
        await db
          .from('leads')
          .update({
            name: name || lead.name,
            last_msg_at: new Date().toISOString(),
          })
          .eq('id', lead_id);
      }
    }

    const intakeData = {
      lead_id: lead_id || null,
      phone: phone || null,
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      experience_level: experience_level || null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      medical_conditions: medical_conditions || null,
      equipment_access: equipment_access || null,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await db
      .from('intake_forms')
      .insert(intakeData);

    if (error && error.code === '42P01') {
      await db.rpc('exec_sql', {
        sql: `CREATE TABLE IF NOT EXISTS intake_forms (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          lead_id UUID,
          phone TEXT,
          name TEXT,
          email TEXT,
          age INTEGER,
          gender TEXT,
          goal TEXT,
          injuries TEXT,
          diet_preference TEXT,
          schedule TEXT,
          experience_level TEXT,
          current_weight NUMERIC(5,1),
          target_weight NUMERIC(5,1),
          medical_conditions TEXT,
          equipment_access TEXT,
          submitted_at TIMESTAMPTZ DEFAULT now()
        )`
      });
      await db.from('intake_forms').insert(intakeData);
    }

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake form error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
