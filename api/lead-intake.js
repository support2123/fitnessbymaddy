const { getClient } = require('../lib/supabase');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_pref, schedule, current_weight, height, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const sb = getClient();

    let lead;
    if (lead_id) {
      const { data } = await sb.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const { data } = await sb.from('leads').select('*').eq('phone', cleanPhone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await sb.from('leads').update({
      name: name || lead.name,
      status: 'qualified',
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead.id);

    const intakeData = {
      lead_id: lead.id,
      phone: lead.phone,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      current_weight: parseFloat(current_weight) || null,
      height: parseFloat(height) || null,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await sb.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });
    if (error) {
      console.error('[INTAKE]', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    console.log(`[INTAKE] Saved for lead ${lead.id} (${maskPhone(lead.phone)})`);
    return res.status(200).json({ status: 'saved', lead_id: lead.id });
  } catch (err) {
    console.error('[INTAKE]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
