const { getSupabase } = require('./_lib/supabase');
const { jsonResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id required' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name: name || lead.name,
      email,
      age: age ? parseInt(age, 10) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
    };

    // Store in leads metadata or wait for conversion to populate clients
    // For now, store as a message for audit trail
    await db.from('messages').insert({
      phone: lead.phone ? lead.phone.slice(0, 4) + 'XXX...' + lead.phone.slice(-3) : 'unknown',
      direction: 'in',
      body: `Intake form: ${JSON.stringify({ age, goal, injuries, diet_pref, schedule })}`,
      template_name: 'intake_form',
      status: 'received',
    });

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
