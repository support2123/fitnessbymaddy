const { Resend } = require('resend');

let client;

function getResend() {
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}

async function sendEmail(to, subject, html) {
  const resend = getResend();
  return resend.emails.send({
    from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
    to,
    subject,
    html
  });
}

module.exports = { sendEmail };
