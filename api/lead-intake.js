const { getSupabase } = require('./_lib/supabase');
const { handleOptions } = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var supabase = getSupabase();
    var b = req.body;

    if (!b.lead_id && !b.phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    var lead;
    if (b.lead_id) {
      var r = await supabase.from('leads').select('*').eq('id', b.lead_id).single();
      lead = r.data;
    } else {
      var normalized = b.phone.replace(/[^0-9+]/g, '');
      if (!normalized.startsWith('+')) normalized = '+' + normalized;
      var r2 = await supabase.from('leads').select('*').eq('phone', normalized).single();
      lead = r2.data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (b.name && b.name !== lead.name) {
      await supabase.from('leads').update({ name: b.name }).eq('id', lead.id);
    }

    await supabase.from('intake_data').upsert({
      lead_id: lead.id,
      name: b.name || null,
      email: b.email || null,
      age: b.age ? parseInt(b.age) : null,
      gender: b.gender || null,
      goal: b.goal || null,
      injuries: b.injuries || null,
      diet_pref: b.diet_pref || null,
      schedule: b.schedule || null,
      experience: b.experience || null,
      current_weight: b.current_weight ? parseFloat(b.current_weight) : null,
      target_weight: b.target_weight ? parseFloat(b.target_weight) : null,
      submitted_at: new Date().toISOString()
    }, { onConflict: 'lead_id' });

    return res.status(200).json({ status: 'ok', message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
