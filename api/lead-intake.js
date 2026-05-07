const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      current_weight, height, activity_level
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead_id);

    const { checkEscalation } = require('../lib/escalation');
    const injuryEscalation = checkEscalation(injuries);
    if (injuryEscalation) {
      const { notifyMaddy } = require('../lib/whatsapp');
      await db.from('escalations').insert({
        phone: phone || lead.phone,
        reason: 'medical_concern_intake',
        message_body: `Injuries/conditions: ${injuries}`
      });
      await notifyMaddy('medical_concern_intake',
        `Lead ${name || 'unknown'} reported: ${injuries}`);
    }

    return res.status(200).json({ ok: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
