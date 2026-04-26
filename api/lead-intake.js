const { supabase } = require('../lib/supabase');
const { ESCALATION_KEYWORDS, maskPhone } = require('../lib/constants');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      height_cm, weight_kg, goal, injuries,
      medical_conditions, diet_preference,
      training_experience, available_days, equipment,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let resolvedLeadId = lead_id;
    if (!resolvedLeadId && phone) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();
      resolvedLeadId = lead?.id;
    }

    if (resolvedLeadId && name) {
      await supabase.from('leads').update({ name }).eq('id', resolvedLeadId);
    }

    const { error } = await supabase.from('intake_submissions').insert({
      lead_id: resolvedLeadId,
      phone, name, email, age: age ? parseInt(age) : null,
      gender, height_cm: height_cm ? parseFloat(height_cm) : null,
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, available_days: available_days ? parseInt(available_days) : null,
      equipment,
    });

    if (error) {
      console.error('[Intake] Insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save' });
    }

    const fieldsToCheck = [injuries, medical_conditions, goal].filter(Boolean).join(' ').toLowerCase();
    if (ESCALATION_KEYWORDS.some(kw => fieldsToCheck.includes(kw))) {
      await notifyMaddy(`Intake flagged for ${maskPhone(phone)}: injuries="${injuries}", medical="${medical_conditions}"`);
    }

    return res.status(200).json({ ok: true, message: 'Intake saved successfully' });
  } catch (err) {
    console.error('[Intake Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
