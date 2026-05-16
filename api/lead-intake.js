const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      current_weight,
      target_weight,
      experience_level,
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
        .limit(1)
        .maybeSingle();
      lead = data;
    }

    if (!lead) {
      const market = detectMarket(phone || '');
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone: phone || '',
          name,
          source: 'intake_form',
          status: 'qualified',
          market,
        })
        .select()
        .single();
      lead = newLead;
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        status: lead.status === 'new' ? 'qualified' : lead.status,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    const { error: profileError } = await supabase
      .from('lead_profiles')
      .upsert({
        lead_id: lead.id,
        email,
        age: age ? parseInt(age) : null,
        gender,
        goal,
        injuries,
        diet_preference,
        schedule,
        current_weight: current_weight ? parseFloat(current_weight) : null,
        target_weight: target_weight ? parseFloat(target_weight) : null,
        experience_level,
        submitted_at: new Date().toISOString(),
      }, { onConflict: 'lead_id' });

    if (profileError) {
      console.error('Profile upsert error:', profileError.message);
    }

    if (lead.phone) {
      const market = detectMarket(lead.phone);
      const msg = isHinglish(market)
        ? [`${name || 'there'}, form mil gaya! Maddy ki team jaldi aapka plan ready karegi.`]
        : [`${name || 'there'}, we've received your details! Maddy's team will prepare your plan shortly.`];
      await sendTemplate(lead.phone, 'intake_received', msg);
    }

    return res.status(200).json({ success: true, leadId: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
