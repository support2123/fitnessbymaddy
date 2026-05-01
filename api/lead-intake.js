const { getSupabase } = require('../lib/supabase');
const { normalizePhone } = require('../lib/phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, goal, injuries,
      diet_pref, schedule, medical_conditions
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const normalized = normalizePhone(phone);
      const { data } = await db
        .from('leads')
        .select('*')
        .eq('phone', normalized)
        .order('created_at', { ascending: false })
        .limit(1);
      lead = data && data[0];
    }

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    // Store intake data as a metadata object on the lead
    // In production, consider a separate intake_data table
    const intakeData = {
      age, goal, injuries, diet_pref, schedule,
      medical_conditions, email,
      submitted_at: new Date().toISOString()
    };

    // Check for escalation keywords in medical conditions / injuries
    const { needsEscalation, escalate } = require('../lib/escalation');
    const combinedText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(combinedText)) {
      await escalate(lead.phone, 'intake_medical_flag', combinedText);
    }

    return res.json({ ok: true, lead_id: lead.id, intake: intakeData });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
