const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  const updates = {};
  if (name) updates.name = name;

  if (lead_id) {
    await supabase.from('leads').update(updates).eq('id', lead_id);
  }

  const clientUpdate = {};
  if (name) clientUpdate.name = name;
  if (email) clientUpdate.email = email;
  if (age) clientUpdate.age = parseInt(age);
  if (goal) clientUpdate.goal = goal;
  if (injuries) clientUpdate.injuries = injuries;
  if (diet_pref) clientUpdate.diet_pref = diet_pref;
  if (schedule) clientUpdate.schedule = schedule;

  const lookupPhone = phone;
  const lookupLead = lead_id;

  if (Object.keys(clientUpdate).length > 0) {
    if (lookupLead) {
      await supabase.from('clients').update(clientUpdate).eq('lead_id', lookupLead);
    } else if (lookupPhone) {
      await supabase.from('clients').update(clientUpdate).eq('phone', lookupPhone);
    }
  }

  return res.status(200).json({ ok: true });
};
