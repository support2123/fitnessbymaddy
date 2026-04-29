const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, email, phone, age, gender, goal, injuries,
    diet_preference, workout_schedule, workout_location,
    current_weight, target_weight, medical_conditions, photos
  } = req.body;

  if (!phone && !lead_id) {
    return res.status(400).json({ error: 'phone or lead_id required' });
  }

  const supabase = getSupabase();

  const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
  if (needsEscalation(medicalText)) {
    await escalateToMaddy('Medical flag in intake form', {
      phone: phone || 'unknown',
      name,
      message: medicalText
    });
  }

  let lead;
  if (lead_id) {
    const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
    lead = data;
  } else {
    const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
    lead = data;
  }

  if (lead) {
    await supabase.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);
  } else {
    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name,
      source: 'intake_form',
      status: 'qualified',
      first_msg: `Intake form: goal=${goal}`,
      market: 'GLOBAL'
    }).select().single();
    lead = newLead;
  }

  const intakeData = {
    lead_id: lead?.id,
    name, email, phone: phone || lead?.phone,
    age: age ? parseInt(age) : null,
    gender, goal, injuries, diet_preference,
    workout_schedule, workout_location,
    current_weight: current_weight ? parseFloat(current_weight) : null,
    target_weight: target_weight ? parseFloat(target_weight) : null,
    medical_conditions,
    submitted_at: new Date().toISOString()
  };

  await supabase.from('intake_forms').insert(intakeData);

  if (lead?.phone) {
    await sendWhatsApp(lead.phone, 'intake_received', {
      name: name || 'there',
      templateParams: [name || 'there']
    });
    await logMessage(lead.phone, 'out', 'Intake form received confirmation', 'intake_received');
  }

  console.log(`Intake received for lead ${maskPhone(phone || lead?.phone)}`);
  return res.status(200).json({ success: true, leadId: lead?.id });
};
