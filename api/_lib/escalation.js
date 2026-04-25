const { getSupabase } = require('./supabase');
const { notifyMaddy } = require('./whatsapp');
const { maskPhone } = require('./utils');

async function checkAndEscalate(phone, text, triggerKeyword) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    trigger_keyword: triggerKeyword,
    message_body: text ? text.substring(0, 1000) : null
  });

  await notifyMaddy(
    'Escalation Required',
    `Phone: ${maskPhone(phone)}\nTrigger: "${triggerKeyword}"\nMessage: ${text ? text.substring(0, 200) : 'N/A'}`
  );

  return true;
}

async function escalateMissedCheckins(clientId, clientName, phone, missedCount) {
  if (missedCount >= 2) {
    await notifyMaddy(
      'Missed Check-ins',
      `Client: ${clientName}\nPhone: ${maskPhone(phone)}\n${missedCount} consecutive missed check-ins`
    );
  }
}

async function escalatePaymentFailure(clientName, phone, program) {
  await notifyMaddy(
    'Payment Failure',
    `Client: ${clientName}\nPhone: ${maskPhone(phone)}\nProgram: ${program}`
  );
}

async function escalateRefund(clientName, phone, message) {
  await notifyMaddy(
    'Refund Request',
    `Client: ${clientName}\nPhone: ${maskPhone(phone)}\nMessage: ${message ? message.substring(0, 200) : 'N/A'}`
  );
}

module.exports = {
  checkAndEscalate,
  escalateMissedCheckins,
  escalatePaymentFailure,
  escalateRefund
};
