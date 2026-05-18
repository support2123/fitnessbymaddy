const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      experience_level, supplements
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();
    const { data: lead, error: leadErr } = await db
      .from('leads').select('*').eq('id', lead_id).single();

    if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with intake data
    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    // Store intake data as a client record (pre-conversion, status comes from leads)
    // We store this as metadata on the lead for now, converting on purchase
    // Using a lightweight approach: store in lead's first_msg as JSON if needed,
    // or we create the client record once Exly webhook fires

    // For now, store intake in a jsonb column approach — let's use the messages table as audit
    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify({
        type: 'intake_form',
        name, email, age, gender, height, weight,
        goal, injuries, diet_pref, schedule,
        medical_conditions, experience_level, supplements
      }),
      status: 'received'
    });

    // Check for medical escalation
    const { needsEscalation } = require('../lib/helpers');
    const combinedText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(combinedText)) {
      const { notifyMaddy } = require('../lib/escalation');
      await notifyMaddy('Medical flag on intake form', { phone: lead.phone, name });
    }

    return res.json({ ok: true, message: 'Intake received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
