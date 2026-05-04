const { supabase } = require('../lib/supabase');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone,
      age, gender, height, weight,
      goal, injuries, diet_pref, schedule,
      medical, supplements, experience
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const combinedMedical = [injuries, medical, supplements].filter(Boolean).join(' ');
    if (needsEscalation(combinedMedical)) {
      const contactPhone = phone || 'unknown';
      await notifyMaddy(
        'Medical concern on intake form',
        contactPhone,
        combinedMedical.slice(0, 200)
      );
    }

    const intakeMeta = {
      email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule,
      medical, supplements, experience,
      submitted_at: new Date().toISOString()
    };

    if (lead_id) {
      await supabase.from('leads').update({
        name: name || undefined,
        meta: intakeMeta,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    } else if (phone) {
      const normalized = phone.replace(/[^0-9]/g, '');
      await supabase.from('leads').update({
        name: name || undefined,
        meta: intakeMeta,
        last_msg_at: new Date().toISOString()
      }).eq('phone', normalized);
    }

    return res.status(200).json({ ok: true, message: 'Intake received' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
