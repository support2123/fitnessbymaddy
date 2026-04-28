const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      training_experience,
      equipment_access,
      schedule_days,
      wake_time,
      sleep_time,
      supplements
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    // Update lead with additional info
    const updates = {};
    if (name) updates.name = name;

    const { error: leadErr } = await db
      .from('leads')
      .update(updates)
      .eq('id', lead_id);

    if (leadErr) {
      console.error('Lead update error:', leadErr.message);
    }

    // If client exists, update their profile too
    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (client) {
      const clientUpdates = {};
      if (name) clientUpdates.name = name;
      if (email) clientUpdates.email = email;

      await db.from('clients').update(clientUpdates).eq('id', client.id);

      // Store intake data as a JSON file in client storage
      const intakeData = {
        submitted_at: new Date().toISOString(),
        age, gender, height, weight, goal,
        injuries, medical_conditions, diet_preference,
        training_experience, equipment_access,
        schedule_days, wake_time, sleep_time, supplements
      };

      await db.storage.from('client-files').upload(
        `clients/${client.id}/intake.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );
    }

    return res.status(200).json({ ok: true, message: 'Intake saved' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
