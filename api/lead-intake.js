const { getSupabase } = require('./_lib/supabase');
const { needsEscalation } = require('./_lib/escalation');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender, goal,
      injuries, diet_pref, schedule, medical_conditions,
      current_weight, target_weight, experience_level
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    // Check if lead exists
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with intake info
    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    // Escalation check on medical fields
    const medicalText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await notifyMaddy(
        'Intake Form — Medical Flag',
        `Lead: ${name || maskPhone(lead.phone)}\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
      );
    }

    // Store intake data as metadata in a JSON column or separate table
    // For now, we store key info inline with the lead and the rest in messages as an audit record
    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify({
        type: 'intake_form',
        name, email, age, gender, goal, injuries,
        diet_pref, schedule, medical_conditions,
        current_weight, target_weight, experience_level
      }),
      template_name: 'intake_form_submission',
      status: 'received'
    });

    return res.status(200).json({ ok: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
