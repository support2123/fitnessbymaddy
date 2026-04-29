const PROGRAM_MAP = {
  'fat loss': { program: '6wk_gym', name: '6 Week Burn & Build', price: 97 },
  'weight': { program: '6wk_gym', name: '6 Week Burn & Build', price: 97 },
  'shred': { program: '6wk_gym', name: '6 Week Burn & Build', price: 97 },
  'pcos': { program: 'pcos', name: 'PCOS Warrior', price: 45 },
  'hormonal': { program: 'pcos', name: 'PCOS Warrior', price: 45 },
  '40': { program: '40plus', name: '40+ Strong', price: 50 },
  'menopause': { program: '40plus', name: '40+ Strong', price: 50 },
  'joints': { program: '40plus', name: '40+ Strong', price: 50 },
  'custom': { program: '12wk', name: '12 Week Flagship', price: 200 },
  '12 week': { program: '12wk', name: '12 Week Flagship', price: 200 },
  'serious': { program: '12wk', name: '12 Week Flagship', price: 200 },
  'trial': { program: 'zoom_trial', name: 'Zoom Trial', price: 20 },
  'zoom': { program: 'zoom_trial', name: 'Zoom Trial', price: 20 },
  'not sure': { program: 'zoom_trial', name: 'Zoom Trial', price: 20 },
};

const CHECKOUT_BASE_URL = 'https://fitnessbymaddyy.exlyapp.com/checkout/';
const FORM_BASE_URL = 'https://fitnessbymaddy.com';
const MADDY_PHONE = '+917082478374';
const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'cancel'];

module.exports = {
  PROGRAM_MAP,
  CHECKOUT_BASE_URL,
  FORM_BASE_URL,
  MADDY_PHONE,
  OPT_OUT_KEYWORDS,
};
