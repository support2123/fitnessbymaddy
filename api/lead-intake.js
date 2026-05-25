const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getClient();
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
    available_equipment,
    weekly_schedule,
    current_activity,
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  let lead;
  if (lead_id) {
    const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
    lead = data;
  } else if (phone) {
    const { data } = await db.from('leads').select('*').eq('phone', phone).single();
    lead = data;
  }

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  await db.from('leads').update({
    name: name || lead.name,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const { data: client, error } = await db.from('clients').upsert({
    lead_id: lead.id,
    phone: lead.phone,
    name: name || lead.name,
    email: email || null,
    status: 'pending',
    intake_data: {
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      available_equipment,
      weekly_schedule,
      current_activity,
    },
  }, { onConflict: 'lead_id' }).select().single();

  if (error) {
    console.error('Intake insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }

  return res.status(200).json({ ok: true, client_id: client?.id });
};
