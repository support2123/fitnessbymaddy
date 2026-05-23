const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { needsEscalation, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, name, email, phone, age, gender,
    goal, injuries, diet_pref, schedule, experience,
    medical_conditions
  } = req.body;

  if (!lead_id) {
    return res.status(400).json({ error: 'Missing lead_id' });
  }

  const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
  const escReason = needsEscalation(medicalText);
  if (escReason) {
    await createEscalation('lead', lead_id, phone, escReason, medicalText);
  }

  const { data: lead } = await db.from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  await db.from('leads')
    .update({
      name: name || lead.name,
      status: 'qualified',
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead_id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead_id}`;

  await sendWhatsApp(lead.phone, 'intake_received', {
    name: name || lead.name || 'there',
    templateParams: [
      name || lead.name || 'there',
      lead.program_interest || 'your selected program',
      checkoutUrl
    ]
  });

  return res.status(200).json({
    success: true,
    checkout_url: checkoutUrl
  });
};
