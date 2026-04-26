const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

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
      workout_experience,
      available_equipment,
      schedule_preference,
      current_activity_level,
      allergies,
      supplements
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await db
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else if (phone) {
      const { data } = await db
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      medical_conditions, diet_preference, workout_experience,
      available_equipment, schedule_preference,
      current_activity_level, allergies, supplements,
      email, submitted_at: new Date().toISOString()
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .limit(1)
      .single();

    if (existingClient) {
      await db
        .from('clients')
        .update({ name: name || lead.name, email })
        .eq('id', existingClient.id);
    }

    return res.status(200).json({
      ok: true,
      message: 'Intake form submitted successfully',
      lead_id: lead.id
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
