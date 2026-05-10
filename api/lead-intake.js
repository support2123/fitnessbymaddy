const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height
    } = req.body || {};

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    const db = getSupabase();

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

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    const metadata = {
      age, gender, goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height
    };

    if (email) updates.email = email;

    await db.from('leads').update({
      ...updates,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name: name || existingClient.name,
        email: email || existingClient.email
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({
      success: true,
      leadId: lead.id,
      message: 'Intake form submitted successfully'
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
