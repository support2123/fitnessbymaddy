const COUNTRY_CODES = ["+971", "+91", "+44", "+1"];

function maskPhone(phone) {
  if (!phone || phone.length < 5) return "***";
  const last3 = phone.slice(-3);
  const cc = COUNTRY_CODES.find((c) => phone.startsWith(c)) || phone.slice(0, 2);
  return `${cc}XXX...${last3}`;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function respond(res, status, data) {
  const headers = corsHeaders();
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.status(status).json(data);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      resolve(req.body);
      return;
    }

    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function validateFields(body, requiredFields) {
  return requiredFields.filter(
    (field) => body[field] === undefined || body[field] === null || body[field] === ""
  );
}

module.exports = { maskPhone, corsHeaders, respond, parseBody, validateFields };
