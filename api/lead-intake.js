const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, schedule,
    medical_conditions, experience_level, photo_urls
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const db = getSupabase();

  const { data: lead, error: leadErr } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (leadErr || !lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  await db.from('leads').update({ name: name || lead.name }).eq('id', lead_id);

  // Store intake data as part of client profile if they convert
  // For now, store extended info in lead metadata via a separate column
  // We'll create the client record when payment comes through (exly-webhook)
  const intakeData = {
    lead_id,
    name,
    email,
    age: parseInt(age) || null,
    gender,
    height,
    weight: parseFloat(weight) || null,
    goal,
    injuries: injuries || 'None',
    diet_preference: diet_preference || 'No preference',
    schedule: schedule || 'Flexible',
    medical_conditions: medical_conditions || 'None',
    experience_level,
    photo_urls: photo_urls || []
  };

  // Store intake in Supabase storage as JSON for later use
  const db2 = getSupabase();
  const filePath = `intakes/${lead_id}.json`;
  await db2.storage.from('clients').upload(filePath, JSON.stringify(intakeData), {
    contentType: 'application/json',
    upsert: true
  });

  return res.status(200).json({ success: true, message: 'Intake form submitted' });
};
