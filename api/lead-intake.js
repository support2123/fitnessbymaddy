const supabase = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, age, phone, email, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions, supplements, motivation
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

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (client) {
      const intakeData = {
        age, gender, goal, injuries, diet_preference, schedule,
        experience_level, current_weight, target_weight,
        medical_conditions, supplements, motivation, email
      };

      const folderPath = `clients/${client.id}`;
      const intakeJson = JSON.stringify(intakeData, null, 2);
      const encoder = new TextEncoder();
      await supabase.storage.from('clients').upload(
        `${folderPath}/intake.json`,
        encoder.encode(intakeJson),
        { contentType: 'application/json', upsert: true }
      );

      if (email) {
        await supabase.from('clients').update({ email, name: name || undefined }).eq('id', client.id);
      }
    }

    return res.status(200).json({ status: 'intake_saved', lead_id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
