const { getSupabase } = require('./lib/supabase');
const { maskPhone, detectMarket, jsonResponse, cors } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const supabase = getSupabase();

  let data;
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) {
    data = req.body;
  } else {
    data = req.body;
  }

  const { name, phone, email, age, gender, height, weight, goal_weight,
    goal, experience, training_location, days_per_week, diet,
    injuries, schedule, notes, lead_id } = data;

  if (!name || !phone || !email) {
    return jsonResponse(res, 400, { error: 'Name, phone, and email are required.' });
  }

  const cleanPhone = phone.startsWith('+') ? phone : '+' + phone.replace(/\s/g, '');
  const market = detectMarket(cleanPhone);

  const intakeData = {
    age: parseInt(age) || null,
    gender, height: parseFloat(height) || null,
    weight: parseFloat(weight) || null,
    goal_weight: parseFloat(goal_weight) || null,
    goal, experience, training_location,
    days_per_week: parseInt(days_per_week) || 5,
    diet, injuries, schedule, notes
  };

  if (lead_id) {
    await supabase.from('leads').update({
      name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);
  } else {
    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', cleanPhone)
      .single();

    if (!existing) {
      await supabase.from('leads').insert({
        phone: cleanPhone,
        name,
        source: 'intake_form',
        status: 'qualified',
        first_msg: `Intake form: ${goal}`,
        market,
      });
    } else {
      await supabase.from('leads').update({
        name,
        status: 'qualified',
        last_msg_at: new Date().toISOString(),
      }).eq('id', existing.id);
    }
  }

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', cleanPhone)
    .single();

  if (existingClient) {
    await supabase.from('clients').update({
      name, email,
    }).eq('id', existingClient.id);
  }

  const escalationWords = ['injury', 'pregnant', 'pregnancy', 'medication', 'surgery', 'heart', 'diabetes'];
  const injuryText = (injuries || '').toLowerCase();
  const needsEscalation = escalationWords.some(w => injuryText.includes(w)) && injuryText !== 'none';

  if (needsEscalation) {
    const { sendWhatsApp } = require('./send-whatsapp');
    await sendWhatsApp({
      phone: '+' + (process.env.MADDY_PHONE || '917082478374'),
      templateName: 'escalation_alert',
      bodyValues: [name, `Medical flag on intake: ${injuries.substring(0, 200)}`],
      isClient: true,
    });
  }

  console.log(`Intake submitted: ${maskPhone(cleanPhone)} goal=${goal}`);
  return jsonResponse(res, 200, { success: true });
};
