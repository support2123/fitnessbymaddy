const { Resend } = require("resend");

let _resend = null;

function getResend() {
  if (_resend) return _resend;

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("Missing required env var: RESEND_API_KEY");
  }

  _resend = new Resend(key);
  return _resend;
}

/**
 * Send an email via Resend.
 *
 * @param {string} to       Recipient email address
 * @param {string} subject  Email subject line
 * @param {string} html     HTML body content
 * @returns {Promise<object>}  Resend API response
 */
async function sendEmail(to, subject, html) {
  const resend = getResend();

  const { data, error } = await resend.emails.send({
    from: "Fitness by Maddy <support@fitnessbymaddy.com>",
    to,
    subject,
    html,
  });

  if (error) {
    console.error("[email] Failed to send:", error);
    throw new Error(`Email send failed: ${error.message || JSON.stringify(error)}`);
  }

  console.log("[email] Sent to", to, "id:", data?.id);
  return data;
}

module.exports = { sendEmail };
