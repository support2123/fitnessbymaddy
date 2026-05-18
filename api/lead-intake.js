const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { needsEscalation } = require('./_lib/escalation');
const { notifyMaddy } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, goal,
      injuries, diet_pref, schedule, medical_conditions,
      current_weight, target_weight, experience_level
    } = req.body;

    if (!lead_id || !name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, phone' });
    }

    const { escalate, reason } = needsEscalation(
      [injuries, medical_conditions, goal].filter(Boolean).join(' ')
    );

    if (escalate) {
      await notifyMaddy(
        'Intake form escalation',
        `Lead: ${name}\nReason: ${reason}\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
      );
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      name, email, phone, age, gender, goal,
      injuries, diet_pref, schedule, medical_conditions,
      current_weight, target_weight, experience_level,
      submitted_at: new Date().toISOString()
    };

    const bucketPath = `intakes/${lead_id}.json`;
    await supabase.storage
      .from('clients')
      .upload(bucketPath, JSON.stringify(intakeData, null, 2), {
        contentType: 'application/json',
        upsert: true
      });

    if (lead.program_interest) {
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead_id}`;
      await sendTemplate(phone, 'intake_received', [name, checkoutUrl]);
    }

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
