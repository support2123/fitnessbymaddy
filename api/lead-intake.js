const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { needsEscalation, getEscalationReason } = require('../lib/escalation');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, medical_conditions, notes
    } = req.body;

    if (!phone && !lead_id) {
      return res.status(400).json({ error: 'Phone or lead_id required' });
    }

    const freeText = [injuries, medical_conditions, notes].filter(Boolean).join(' ');
    if (needsEscalation(freeText)) {
      await notifyMaddy(
        'Intake form — medical flag',
        `Name: ${name}\nPhone: ${maskPhone(phone)}\nReason: ${getEscalationReason(freeText)}\nDetails: "${freeText.slice(0, 300)}"`
      );
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .maybeSingle();
      lead = data;
    } else if (phone) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();
      lead = data;
    }

    if (lead) {
      await supabase.from('leads').update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);
    }

    const intakeData = {
      lead_id: lead ? lead.id : null,
      phone: phone || (lead ? lead.phone : null),
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      experience_level: experience_level || null,
      medical_conditions: medical_conditions || null,
      notes: notes || null,
      submitted_at: new Date().toISOString()
    };

    const { error: storageError } = await supabase
      .from('intake_forms')
      .insert(intakeData);

    if (storageError && storageError.code === '42P01') {
      await supabase.rpc('create_intake_table_if_missing');
    }

    if (lead && lead.phone) {
      await sendTemplate(lead.phone, 'intake_received', [name || 'there']);
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to submit intake form' });
  }
};
