// Template/campaign resolution. AiSensy templates must be pre-approved.
// Keys are logical names; values come from env so ops can swap without code changes.

function campaign(name) {
  const map = {
    welcome: process.env.AISENSY_CAMPAIGN_WELCOME,
    nudge_trial: process.env.AISENSY_CAMPAIGN_NUDGE_TRIAL,
    onboard_6wk_gym: process.env.AISENSY_CAMPAIGN_ONBOARD_6WK,
    onboard_6wk_home: process.env.AISENSY_CAMPAIGN_ONBOARD_6WK,
    onboard_12wk: process.env.AISENSY_CAMPAIGN_ONBOARD_12WK,
    onboard_pcos: process.env.AISENSY_CAMPAIGN_ONBOARD_PCOS,
    onboard_40plus: process.env.AISENSY_CAMPAIGN_ONBOARD_40PLUS,
    onboard_zoom_trial: process.env.AISENSY_CAMPAIGN_ONBOARD_ZOOM,
    onboard_zoom_pack: process.env.AISENSY_CAMPAIGN_ONBOARD_ZOOM,
    checkin: process.env.AISENSY_CAMPAIGN_CHECKIN,
    program_ready: process.env.AISENSY_CAMPAIGN_PROGRAM_READY,
    checkin_nudge: process.env.AISENSY_CAMPAIGN_CHECKIN_NUDGE,
  };
  return map[name] || null;
}

// Hinglish for IN, English for others.
function welcomeBody(market) {
  if (market === 'IN') {
    return "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
  }
  return "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS, strength, or 40+ fitness? Or want to try a trial first?";
}

function nudgeTrialBody(market, trialUrl) {
  if (market === 'IN') {
    return `Abhi sure nahi? Ek $20 Zoom trial try karo — Maddy ke saath live 30-min session. Book: ${trialUrl}`;
  }
  return `Still thinking? Try a $20 Zoom trial — 30-min live session with Maddy. Book: ${trialUrl}`;
}

function onboardBody(program, market, name) {
  const first = (name || '').split(' ')[0] || 'there';
  const map_IN = {
    '6wk_gym': `${first}, welcome to 6-Week Burn & Build (Gym)! Aaj se tracking shuru. Intake bhara kya? Nahi toh: {INTAKE_URL}`,
    '6wk_home': `${first}, welcome to 6-Week Burn & Build (Home)! Aaj se tracking shuru. Intake form: {INTAKE_URL}`,
    '12wk': `${first}, welcome to 12-Week Flagship 🔥 Maddy aapka custom program build kar rahi hain. Intake: {INTAKE_URL}`,
    'pcos': `${first}, welcome to PCOS Warrior! Hormones-first approach. Intake: {INTAKE_URL}`,
    '40plus': `${first}, welcome to 40+ Strong! Joints-safe, strength-focused. Intake: {INTAKE_URL}`,
    'zoom_trial': `${first}, welcome to your Zoom trial! Booking link aayega. Intake: {INTAKE_URL}`,
    'zoom_pack': `${first}, welcome to your Zoom coaching pack! Intake: {INTAKE_URL}`,
  };
  const map_EN = {
    '6wk_gym': `${first}, welcome to 6-Week Burn & Build (Gym)! Tracking starts today. Please fill intake: {INTAKE_URL}`,
    '6wk_home': `${first}, welcome to 6-Week Burn & Build (Home)! Please fill intake: {INTAKE_URL}`,
    '12wk': `${first}, welcome to the 12-Week Flagship 🔥 Maddy is building your custom program. Intake: {INTAKE_URL}`,
    'pcos': `${first}, welcome to PCOS Warrior! Hormones-first approach. Intake: {INTAKE_URL}`,
    '40plus': `${first}, welcome to 40+ Strong! Joint-safe, strength-focused. Intake: {INTAKE_URL}`,
    'zoom_trial': `${first}, welcome to your Zoom trial! Intake: {INTAKE_URL}`,
    'zoom_pack': `${first}, welcome to your Zoom coaching pack! Intake: {INTAKE_URL}`,
  };
  return (market === 'IN' ? map_IN : map_EN)[program] || map_EN[program];
}

function checkinBody(market, weekNo, url) {
  if (market === 'IN') {
    return `Week ${weekNo} ka check-in due hai 📋 Weight, waist, energy aur 3 photos — 3 min lagenge: ${url}`;
  }
  return `Week ${weekNo} check-in is due 📋 Weight, waist, energy and 3 photos — takes 3 min: ${url}`;
}

function programReadyBody(market, weekNo, note) {
  if (market === 'IN') {
    return `Week ${weekNo} ka plan ready hai 💪 ${note || ''}`.trim();
  }
  return `Your Week ${weekNo} plan is ready 💪 ${note || ''}`.trim();
}

module.exports = {
  campaign,
  welcomeBody, nudgeTrialBody, onboardBody,
  checkinBody, programReadyBody,
};
