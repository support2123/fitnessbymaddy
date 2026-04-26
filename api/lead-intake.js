const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { jsonResponse, errorResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_pref, schedule, medical_conditions, current_weight,
      target_weight, experience_level
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
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
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      name, email, age, gender, goal, injuries,
      diet_pref, schedule, medical_conditions,
      current_weight, target_weight, experience_level,
      submitted_at: new Date().toISOString()
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name,
        email
      }).eq('id', existingClient.id);
    }

    if (lead.phone) {
      await sendTemplate(lead.phone, 'intake_received', [name || 'there']);
    }

    return res.status(200).json({ ok: true, message: 'Intake form received' });
  } catch (err) {
    console.error('[Intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
