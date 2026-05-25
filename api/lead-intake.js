const { supabase } = require('./_lib/supabase');
const { normalizePhone, detectMarket } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      current_weight, target_weight, height
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
        .maybeSingle();
      lead = data;
    } else {
      const normalized = normalizePhone(phone);
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', normalized)
        .maybeSingle();
      lead = data;
    }

    if (!lead) {
      const normalized = normalizePhone(phone);
      const { data } = await supabase
        .from('leads')
        .insert({
          phone: normalized,
          name,
          source: 'intake_form',
          status: 'qualified',
          market: detectMarket(normalized),
          program_interest: goal
        })
        .select()
        .single();
      lead = data;
    } else {
      await supabase
        .from('leads')
        .update({
          name: name || lead.name,
          status: lead.status === 'new' ? 'qualified' : lead.status,
          program_interest: goal || lead.program_interest
        })
        .eq('id', lead.id);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_pref,
      schedule, experience, current_weight,
      target_weight, height, email
    };

    const { error } = await supabase
      .from('leads')
      .update({ first_msg: JSON.stringify(intakeData) })
      .eq('id', lead.id);

    if (error) throw error;

    return res.json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
