const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./helpers');

async function escalateToMaddy(reason, phone, details = '') {
  const maddyPhone = process.env.MADDY_PHONE;
  if (!maddyPhone) {
    console.error('[ESCALATION] MADDY_PHONE not set');
    return;
  }

  const msg = `ALERT: ${reason}\nClient: ${maskPhone(phone)}\n${details}`.slice(0, 900);

  await sendWhatsApp({
    phone: maddyPhone,
    body: msg,
  });

  console.log(`[ESCALATION] ${reason} for ${maskPhone(phone)}`);
}

module.exports = { escalateToMaddy };
