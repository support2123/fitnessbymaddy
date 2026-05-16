const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, logMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./_lib/escalation');
const { qualifyLead, getCheckoutUrl, getIntakeUrl } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text.substring(0, 200));
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'existing_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      const route = qualifyLead(text);
      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route.program
        }).eq('id', existingLead.id);

        const checkoutUrl = getCheckoutUrl(route.program);
        const intakeUrl = getIntakeUrl(existingLead.id);

        if (isHinglish(market)) {
          await sendTemplate(phone, 'qualified_hinglish', [
            name || 'there',
            route.name,
            `$${route.price}`,
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(phone, 'qualified_english', [
            name || 'there',
            route.name,
            `$${route.price}`,
            checkoutUrl,
            intakeUrl
          ]);
        }

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      return res.status(200).json({ action: 'existing_lead', lead_id: existingLead.id });
    }

    const { data: newLead, error: insertError } = await db
      .from('leads')
      .insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text ? text.substring(0, 500) : null,
        last_msg_at: new Date().toISOString(),
        market
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Lead insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to create lead' });
    }

    if (isHinglish(market)) {
      await sendTemplate(phone, 'welcome_v1_hinglish', [name || 'there']);
    } else {
      await sendTemplate(phone, 'welcome_v1_english', [name || 'there']);
    }

    const route = qualifyLead(text);
    if (route) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: route.program
      }).eq('id', newLead.id);

      const checkoutUrl = getCheckoutUrl(route.program);
      const intakeUrl = getIntakeUrl(newLead.id);

      setTimeout(async () => {
        if (isHinglish(market)) {
          await sendTemplate(phone, 'qualified_hinglish', [
            name || 'there',
            route.name,
            `$${route.price}`,
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(phone, 'qualified_english', [
            name || 'there',
            route.name,
            `$${route.price}`,
            checkoutUrl,
            intakeUrl
          ]);
        }
      }, 3000);
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
