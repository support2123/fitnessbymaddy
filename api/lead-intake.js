const { getClient } = require('../lib/supabase');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const supabase = getClient();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    if (Object.keys(updates).length > 0) {
      await supabase.from('leads').update(updates).eq('id', lead_id);
    }

    const intakeData = {
      lead_id, name, email, phone: phone || lead.phone,
      age, gender, goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height, submitted_at: new Date().toISOString()
    };

    const { error: storageErr } = await supabase.storage
      .from('client-data')
      .upload(
        `intakes/${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageErr) {
      console.error('Storage upload error:', storageErr.message);
    }

    const hasEscalationCondition = [injuries, medical_conditions]
      .filter(Boolean)
      .some(v => v.trim().length > 0 && v.toLowerCase() !== 'none' && v.toLowerCase() !== 'no');

    if (hasEscalationCondition) {
      const { notifyMaddy } = require('../lib/escalation');
      await notifyMaddy(supabase, 'Intake form: medical/injury noted', {
        phone: maskPhone(lead.phone),
        injuries,
        medical_conditions
      });
    }

    console.log(`Intake submitted for lead ${maskPhone(lead.phone)}`);
    return res.status(200).json({ ok: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
