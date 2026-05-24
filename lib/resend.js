const { Resend } = require('resend');

let client;

function getResend() {
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}

async function sendEmail({ to, subject, html }) {
  const resend = getResend();
  return resend.emails.send({
    from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
    to,
    subject,
    html
  });
}

async function sendWelcomeEmail(email, name, program) {
  return sendEmail({
    to: email,
    subject: `Welcome to ${program} — Fitness by Maddy`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
        <h1 style="color:#2C2C2C;font-size:28px;font-weight:400">Welcome, ${name}!</h1>
        <p style="color:#6B6B6B;line-height:1.7">
          You're now enrolled in <strong>${program}</strong>. Here's what happens next:
        </p>
        <ol style="color:#6B6B6B;line-height:2">
          <li>Fill out your intake form (link sent on WhatsApp)</li>
          <li>Maddy reviews your profile and designs your program</li>
          <li>Your Week 1 plan arrives within 48 hours</li>
        </ol>
        <p style="color:#6B6B6B;line-height:1.7">
          Questions? Reply to this email or message us on WhatsApp.
        </p>
        <p style="color:#B8965A;font-weight:600;margin-top:32px">— Team Fitness by Maddy</p>
      </div>
    `
  });
}

module.exports = { sendEmail, sendWelcomeEmail };
