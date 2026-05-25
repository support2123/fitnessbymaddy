const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      medical_conditions,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    const needsEscalation =
      medical_conditions &&
      /\b(surgery|diabetes|heart|pregnant|epilepsy|cancer)\b/i.test(medical_conditions);

    if (needsEscalation) {
      const { escalate } = require('../lib/escalation');
      await escalate(
        lead.phone,
        'medical_condition_on_intake',
        `Medical: ${medical_conditions}`
      );
    }

    return res.status(200).json({
      success: true,
      lead_id: lead.id,
      escalated: !!needsEscalation,
      message: needsEscalation
        ? 'Form received. Maddy will personally review your profile due to medical conditions.'
        : 'Form received! You will receive your program details shortly after payment.',
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
