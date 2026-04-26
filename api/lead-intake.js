const { getSupabase } = require('../lib/supabase');
const { corsHeaders } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).set(corsHeaders()).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lead_id,
    name,
    email,
    phone,
    age,
    goal,
    injuries,
    diet_pref,
    schedule,
    experience,
    current_weight,
    target_weight,
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  const db = getSupabase();

  // Update lead if we have lead_id
  if (lead_id) {
    await db.from('leads').update({ name }).eq('id', lead_id);
  }

  // Check if client already exists
  const lookupField = lead_id ? 'lead_id' : 'phone';
  const lookupValue = lead_id || phone;

  const { data: existing } = await db
    .from('clients')
    .select('id')
    .eq(lookupField, lookupValue)
    .maybeSingle();

  if (existing) {
    // Update existing client profile
    await db
      .from('clients')
      .update({
        name: name || undefined,
        email: email || undefined,
        age: age || undefined,
        goal: goal || undefined,
        injuries: injuries || undefined,
        diet_pref: diet_pref || undefined,
        schedule: schedule || undefined,
      })
      .eq('id', existing.id);

    return res.status(200).json({ ok: true, client_id: existing.id, updated: true });
  }

  // Create client record (will be activated on payment via exly-webhook)
  const { data: client, error } = await db
    .from('clients')
    .insert({
      lead_id: lead_id || null,
      phone: phone || '',
      name,
      email,
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      status: 'paused',
    })
    .select()
    .single();

  if (error) {
    console.error('Intake insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }

  return res.status(200).json({ ok: true, client_id: client.id });
};
