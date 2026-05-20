const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let leadRecord;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      leadRecord = data;
    } else if (phone) {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      leadRecord = data;
    }

    if (!leadRecord) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead name if provided
    if (name) {
      await supabase.from('leads').update({ name }).eq('id', leadRecord.id);
    }

    // Store intake data as client draft (won't be active until payment)
    const { error } = await supabase.from('clients').upsert({
      lead_id: leadRecord.id,
      phone: leadRecord.phone,
      name: name || leadRecord.name,
      email,
      program: leadRecord.program_interest || '12wk',
      status: 'paused',
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule
    }, { onConflict: 'lead_id' });

    if (error) throw error;

    return res.json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
