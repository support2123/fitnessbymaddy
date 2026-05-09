const { getSupabase } = require('./lib/supabase');
const { sendTemplate, normalizePhone, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, notifyMaddy } = require('./lib/escalation');
const { logMessage } = require('./lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const supabase = getSupabase();

    let leadId = lead_id;
    if (!leadId && phone) {
      const normalized = normalizePhone(phone);
      const { data } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', normalized)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      leadId = data?.id;
    }

    if (leadId) {
      await supabase
        .from('leads')
        .update({
          name: name || undefined,
          last_msg_at: new Date().toISOString(),
        })
        .eq('id', leadId);
    }

    const intakeNote = [
      `Age: ${age || 'N/A'}`,
      `Gender: ${gender || 'N/A'}`,
      `Goal: ${goal || 'N/A'}`,
      `Injuries: ${injuries || 'None'}`,
      `Diet: ${diet_pref || 'N/A'}`,
      `Schedule: ${schedule || 'N/A'}`,
      `Experience: ${experience || 'N/A'}`,
      `Medical: ${medical_conditions || 'None'}`,
    ].join(' | ');

    const escalationText = `${injuries || ''} ${medical_conditions || ''}`;
    if (needsEscalation(escalationText)) {
      await notifyMaddy(
        'Intake form — medical flag',
        `${name || maskPhone(phone)}: ${escalationText.slice(0, 200)}`
      );
    }

    if (phone) {
      await logMessage(normalizePhone(phone), 'in', `Intake submitted: ${intakeNote}`, null);
    }

    return res.status(200).json({ ok: true, leadId });
  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
