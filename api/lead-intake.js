const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { maskPhone, corsHeaders } = require('./lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender, goal, injuries,
      diet_pref, schedule, experience, current_weight, target_weight,
    } = req.body || {};

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

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      experience, current_weight, target_weight, email,
      submitted_at: new Date().toISOString(),
    };

    const finalPhone = phone || lead.phone;

    await sendWhatsApp({
      phone: finalPhone,
      templateName: 'intake_received',
      bodyValues: [name || lead.name || 'there'],
    });

    console.log(`[Intake] Received for lead ${lead_id} (${maskPhone(finalPhone)})`);

    return res.status(200).json({ ok: true, lead_id });
  } catch (err) {
    console.error('[Intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
