/* PCRED Udyam Scheme Report: rules engine, report renderer and PDF export (website edition).
 *
 * Ported from the original single-file report page. The certificate upload and Claude reading
 * were replaced by the Udyam Verification card, which feeds the verified Udyam record in through
 * applyUdyam(). Scheme data lives in src/data/*.json; the central scheme rules are the block between
 * the "scheme rules" and "state, sector, export and startup data" markers below, so
 * scripts/sync-from-artifact.mjs can refresh both after each monthly rule check.
 *
 * Runs in the browser only: import it dynamically from a client component after mount.
 */
import statesData from '../data/states.json';
import extrasData from '../data/extras.json';

let engine = null;

/** Wires the report into the page (once) and returns its API. */
export function initReport() {
  if (!engine) engine = createEngine();
  return engine;
}

// Body intentionally not indented: it mirrors the original report page so monthly rule
// updates can be copied across verbatim.
function createEngine() {

/* ---------------------------------------------------------------- setup */
const VERIFIED = '28 Sep 2026';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const BRAND = {
  light: '/brand/pcred-logo.png',
  dark: '/brand/pcred-logo-dark.png',
  mark: '/brand/pcred-mark.png',
  ratio: 193 / 720, markRatio: 218 / 256,
};
// jsPDF needs the logos as data URLs; fetch them once, when the first PDF is built.
let brandImages = null;
function loadBrandImages() {
  if (!brandImages) {
    const toDataUrl = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('logo ' + r.status); return r.blob(); })
      .then((b) => new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(b); }));
    brandImages = Promise.all([toDataUrl(BRAND.dark), toDataUrl(BRAND.mark)])
      .then(([dark, mark]) => ({ dark, mark }))
      .catch((e) => { brandImages = null; throw e; });
  }
  return brandImages;
}

/* ------------------------------------------------------- reference data */
const STATES = [
  ['Andaman and Nicobar Islands', ['ANDAMAN AND NICOBAR ISLANDS', 'ANDAMAN & NICOBAR ISLANDS', 'ANDAMAN AND NICOBAR', 'ANDAMAN & NICOBAR']],
  ['Andhra Pradesh', ['ANDHRA PRADESH']], ['Arunachal Pradesh', ['ARUNACHAL PRADESH']], ['Assam', ['ASSAM']], ['Bihar', ['BIHAR']],
  ['Chandigarh', ['CHANDIGARH']], ['Chhattisgarh', ['CHHATTISGARH', 'CHATTISGARH']],
  ['Dadra and Nagar Haveli and Daman and Diu', ['THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'DADRA & NAGAR HAVELI', 'DADRA AND NAGAR HAVELI', 'DAMAN AND DIU', 'DAMAN & DIU']],
  ['Delhi', ['NCT OF DELHI', 'DELHI']], ['Goa', ['GOA']], ['Gujarat', ['GUJARAT']], ['Haryana', ['HARYANA']],
  ['Himachal Pradesh', ['HIMACHAL PRADESH']], ['Jammu and Kashmir', ['JAMMU AND KASHMIR', 'JAMMU & KASHMIR']], ['Jharkhand', ['JHARKHAND']],
  ['Karnataka', ['KARNATAKA']], ['Kerala', ['KERALA']], ['Ladakh', ['LADAKH']], ['Lakshadweep', ['LAKSHADWEEP']],
  ['Madhya Pradesh', ['MADHYA PRADESH']], ['Maharashtra', ['MAHARASHTRA']], ['Manipur', ['MANIPUR']], ['Meghalaya', ['MEGHALAYA']],
  ['Mizoram', ['MIZORAM']], ['Nagaland', ['NAGALAND']], ['Odisha', ['ODISHA', 'ORISSA']], ['Puducherry', ['PUDUCHERRY', 'PONDICHERRY']],
  ['Punjab', ['PUNJAB']], ['Rajasthan', ['RAJASTHAN']], ['Sikkim', ['SIKKIM']], ['Tamil Nadu', ['TAMIL NADU', 'TAMILNADU']],
  ['Telangana', ['TELANGANA']], ['Tripura', ['TRIPURA']], ['Uttar Pradesh', ['UTTAR PRADESH']], ['Uttarakhand', ['UTTARAKHAND', 'UTTARANCHAL']],
  ['West Bengal', ['WEST BENGAL']],
];
const URN_STATE = { AN: 'Andaman and Nicobar Islands', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CH: 'Chandigarh', CG: 'Chhattisgarh', CT: 'Chhattisgarh', DN: 'Dadra and Nagar Haveli and Daman and Diu', DD: 'Dadra and Nagar Haveli and Daman and Diu', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana', HP: 'Himachal Pradesh', JK: 'Jammu and Kashmir', JH: 'Jharkhand', KA: 'Karnataka', KR: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep', MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya', MZ: 'Mizoram', NL: 'Nagaland', OD: 'Odisha', OR: 'Odisha', PY: 'Puducherry', PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu', TS: 'Telangana', TG: 'Telangana', TR: 'Tripura', UP: 'Uttar Pradesh', UK: 'Uttarakhand', UT: 'Uttarakhand', WB: 'West Bengal' };
const NER = new Set(['Arunachal Pradesh', 'Assam', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Sikkim', 'Tripura']);
const HIMALAYAN = new Set(['Jammu and Kashmir', 'Ladakh', 'Himachal Pradesh', 'Uttarakhand']);
const ISLAND = new Set(['Andaman and Nicobar Islands', 'Lakshadweep']);

const SIZE_L = { micro: 'Micro', small: 'Small', medium: 'Medium' };
const ACT_L = { manufacturing: 'Manufacturing', services: 'Services', trading: 'Trading' };
const SOCIAL_L = { general: 'General', obc: 'OBC', sc: 'SC', st: 'ST' };
const ORG_L = { proprietorship: 'Proprietorship', partnership: 'Partnership firm', llp: 'LLP', pvt: 'Private limited company', public: 'Public limited company', other: 'Other (HUF, trust, society, co-op)' };

const GOALS = [
  ['credit', 'Loans & working capital'], ['machinery', 'New machinery'], ['quality', 'Certification & quality'],
  ['govt', 'Sell to government'], ['market', 'Marketing & online sales'], ['exports', 'Export'],
  ['payments', 'Get paid on time'], ['hiring', 'Hire staff'], ['ip', 'Patents & trademarks'], ['equity', 'Equity investment'],
];
const LOANS = [['upto5l', 'Up to ₹5 lakh'], ['5to20l', '₹5–20 lakh'], ['20lto1cr', '₹20 lakh–₹1 crore'], ['1to10cr', '₹1–10 crore'], ['above10cr', 'Above ₹10 crore']];

// PM Vishwakarma: 18 trades mapped to NIC-2008 5-digit codes (best mapping; no official table)
const PMV_TRADES = [
  { trade: 'Carpenter', who: 'carpenters', main: ['16221', '31001'], other: ['16229', '16293', '16299', '43301', '95240'] },
  { trade: 'Boat maker', who: 'boat makers', main: ['30113'], other: ['30111', '30120'] },
  { trade: 'Armourer', who: 'armourers', main: ['25931'], other: ['25200'] },
  { trade: 'Blacksmith', who: 'blacksmiths', main: ['25910', '25932'], other: ['25933', '25994', '25999'] },
  { trade: 'Hammer & tool kit maker', who: 'tool makers', main: ['25933'], other: ['25939'] },
  { trade: 'Locksmith', who: 'locksmiths', main: ['25934'], other: ['95299'] },
  { trade: 'Goldsmith', who: 'goldsmiths', main: ['32111'], other: ['32119', '95293', '32120'] },
  { trade: 'Potter', who: 'potters', main: ['23931'], other: ['23932', '23933', '23939', '23929'] },
  { trade: 'Sculptor / stone carver', who: 'sculptors', main: ['23960', '90003'], other: ['08106', '08103'] },
  { trade: 'Cobbler / footwear artisan', who: 'cobblers', main: ['15201', '95230'], other: ['15209'] },
  { trade: 'Mason', who: 'masons', main: ['43900', '41001'], other: ['41002', '43303'] },
  { trade: 'Basket, mat, broom maker / coir weaver', who: 'basket and mat makers', main: ['16294', '16295', '16296'], other: ['13935', '13943', '31002'] },
  { trade: 'Traditional doll & toy maker', who: 'toy makers', main: ['32401'], other: ['32409'] },
  { trade: 'Barber', who: 'barbers', main: ['96020'], other: [] },
  { trade: 'Garland maker', who: 'garland makers', main: [], other: ['32909', '47734'] },
  { trade: 'Washerman', who: 'washermen', main: ['96010'], other: [] },
  { trade: 'Tailor', who: 'tailors', main: ['14105', '14101'], other: ['95292', '13991'] },
  { trade: 'Fishing net maker', who: 'fishing net makers', main: ['13945'], other: ['13944', '13949'] },
];

// ADEETIE: 14 sectors in 60 clusters (cluster list from a secondary compilation of BEE's list)
const ADEETIE = [
  { name: 'Brass', nic4: ['2420', '2599'], clusters: ['Jagadhri', 'Jamnagar', 'Moradabad', 'Salem'] },
  { name: 'Bricks', nic4: ['2392'], clusters: ['Bengaluru', 'Begusarai', 'Indore', 'Nagpur', 'Tripura'] },
  { name: 'Ceramics', nic4: ['2392', '2393'], clusters: ['Morbi', 'Thangadh', 'Khurja'] },
  { name: 'Chemicals', nic2: ['20'], clusters: ['Ankleshwar-Panoli', 'Jamshedpur', 'Karnal', 'Thane', 'Vapi'] },
  { name: 'Fisheries', nic4: ['1020'], clusters: ['Kochi', 'Bhubaneswar', 'West Godavari'] },
  { name: 'Food processing', nic2: ['10'], clusters: ['Ganjam-Nayagarh', 'Kaithal', 'Ludhiana', 'Pune'] },
  { name: 'Forging', nic4: ['2591'], clusters: ['Bengaluru', 'Pune', 'Delhi-NCR', 'Chennai', 'Ludhiana'] },
  { name: 'Foundry', nic4: ['2431', '2432'], clusters: ['Batala', 'Jalandhar', 'Ludhiana', 'Howrah', 'Rajkot', 'Belagavi', 'Coimbatore'] },
  { name: 'Glass & refractory', nic4: ['2310', '2391'], clusters: ['Ambala', 'Chirkunda', 'East & West Godavari', 'Firozabad'] },
  { name: 'Leather', nic4: ['1511', '1512', '1520'], clusters: ['Kanpur', 'Kolkata', 'Pallavaram-Vaniyambadi', 'Jalandhar'] },
  { name: 'Paper', nic4: ['1701', '1709'], clusters: ['Muzaffarnagar', 'Saharanpur', 'Kashipur', 'Vapi', 'Coimbatore-Erode'] },
  { name: 'Pharma', nic4: ['2100'], clusters: ['Baddi', 'Medak', 'Margao', 'Ahmedabad', 'Bidar'] },
  { name: 'Steel re-rolling', nic4: ['2410'], clusters: ['Mandi Gobindgarh-Ludhiana', 'Jaipur', 'Jalna', 'Raipur'] },
  { name: 'Textiles', nic2: ['13'], clusters: ['Ludhiana', 'Surat', 'Tiruppur', 'Solapur', 'Panipat'] },
];
const CLUSTER_DISTRICTS = {
  'Jagadhri': ['YAMUNANAGAR', 'YAMUNA NAGAR'], 'Jamnagar': ['JAMNAGAR'], 'Moradabad': ['MORADABAD'], 'Salem': ['SALEM'],
  'Bengaluru': ['BENGALURU', 'BANGALORE', 'BENGALURU URBAN', 'BANGALORE URBAN', 'BENGALURU RURAL', 'BANGALORE RURAL'],
  'Begusarai': ['BEGUSARAI'], 'Indore': ['INDORE'], 'Nagpur': ['NAGPUR'], 'Tripura': ['@Tripura'],
  'Morbi': ['MORBI', 'MORVI'], 'Thangadh': ['SURENDRANAGAR'], 'Khurja': ['BULANDSHAHR', 'BULANDSHAHAR'],
  'Ankleshwar-Panoli': ['BHARUCH'], 'Jamshedpur': ['EAST SINGHBHUM', 'PURBI SINGHBHUM'], 'Karnal': ['KARNAL'], 'Thane': ['THANE'], 'Vapi': ['VALSAD'],
  'Kochi': ['ERNAKULAM'], 'Bhubaneswar': ['KHORDHA', 'KHURDA', 'KHORDA'], 'West Godavari': ['WEST GODAVARI', 'ELURU'],
  'Ganjam-Nayagarh': ['GANJAM', 'NAYAGARH'], 'Kaithal': ['KAITHAL'], 'Ludhiana': ['LUDHIANA'], 'Pune': ['PUNE'],
  'Delhi-NCR': ['@Delhi', 'GURUGRAM', 'GURGAON', 'FARIDABAD', 'GAUTAM BUDDHA NAGAR', 'GHAZIABAD', 'SONIPAT', 'SONEPAT'],
  'Chennai': ['CHENNAI', 'TIRUVALLUR', 'KANCHEEPURAM', 'CHENGALPATTU'],
  'Batala': ['GURDASPUR'], 'Jalandhar': ['JALANDHAR'], 'Howrah': ['HOWRAH'], 'Rajkot': ['RAJKOT'], 'Belagavi': ['BELAGAVI', 'BELGAUM'], 'Coimbatore': ['COIMBATORE'],
  'Ambala': ['AMBALA'], 'Chirkunda': ['DHANBAD'], 'East & West Godavari': ['EAST GODAVARI', 'WEST GODAVARI', 'KAKINADA', 'ELURU', 'KONASEEMA'], 'Firozabad': ['FIROZABAD'],
  'Kanpur': ['KANPUR NAGAR', 'KANPUR DEHAT', 'KANPUR'], 'Kolkata': ['KOLKATA', 'SOUTH 24 PARGANAS', 'NORTH 24 PARGANAS'],
  'Pallavaram-Vaniyambadi': ['CHENGALPATTU', 'KANCHEEPURAM', 'TIRUPATHUR', 'VELLORE', 'RANIPET'],
  'Muzaffarnagar': ['MUZAFFARNAGAR'], 'Saharanpur': ['SAHARANPUR'], 'Kashipur': ['UDHAM SINGH NAGAR'], 'Coimbatore-Erode': ['COIMBATORE', 'ERODE'],
  'Baddi': ['SOLAN'], 'Medak': ['MEDAK', 'SANGAREDDY'], 'Margao': ['SOUTH GOA'], 'Ahmedabad': ['AHMEDABAD'], 'Bidar': ['BIDAR'],
  'Mandi Gobindgarh-Ludhiana': ['FATEHGARH SAHIB', 'LUDHIANA'], 'Jaipur': ['JAIPUR'], 'Jalna': ['JALNA'], 'Raipur': ['RAIPUR'],
  'Surat': ['SURAT'], 'Tiruppur': ['TIRUPPUR', 'TIRUPUR'], 'Solapur': ['SOLAPUR'], 'Panipat': ['PANIPAT'],
};

/* ------------------------------------------------------- example + state */
const FIELDS = ['name', 'urn', 'size', 'activity', 'social', 'state', 'district', 'orgType', 'commenced', 'nic'];
const blankProfile = () => ({ name: '', urn: '', size: '', sizeYear: '', activity: '', social: '', state: '', district: '', city: '', pin: '', incorporated: '', commenced: '', registered: '', nic: [], dic: '', dfo: '', orgType: '', gender: '' });
const blankAnswers = () => ({ women: null, goals: [], loan: null });
const state = {
  mode: 'empty',
  profile: blankProfile(),
  src: {},
  answers: blankAnswers(),
  womenSrc: '',
  showAll: false,
  file: null,
};

/* ----------------------------------------------------------- utilities */
function prettyName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().replace(/^M\/S\.?\s+/i, '').split(' ').map((w) => {
    if (/^[A-Z0-9&./()-]+$/.test(w) && w.replace(/[^A-Z]/g, '').length > 3) return w.charAt(0) + w.slice(1).toLowerCase();
    return w;
  }).join(' ');
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()); }
function toDate(dmy) {
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(String(dmy || '').trim());
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return isNaN(d) ? null : d;
}
function sinceText(dmy) {
  const d = toDate(dmy);
  if (!d) return '';
  const now = new Date();
  let yrs = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) yrs--;
  const mon = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  return yrs >= 1 ? `${mon} · ${yrs} yr${yrs === 1 ? '' : 's'}` : `${mon} · under a year`;
}
function normState(s) {
  const up = String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!up) return '';
  for (const [name, al] of STATES) for (const a of al) if (up === a || up.startsWith(a + ' ') || up.startsWith(a + ',')) return name;
  return '';
}
function findStateIn(text) {
  const up = String(text || '').toUpperCase();
  let best = null;
  for (const [name, al] of STATES) for (const a of al) {
    const re = new RegExp('(^|[^A-Z])' + a.replace(/[&]/g, '\\&').replace(/ /g, '\\s+') + '([^A-Z]|$)');
    const m = re.exec(up);
    if (m && (!best || a.length > best.len)) best = { name, len: a.length };
  }
  return best ? best.name : '';
}
function orgFromText(s) {
  const up = String(s || '').toUpperCase();
  if (/PRIVATE\s+LIMITED|PVT\.?\s*LTD|\(P\)\s*LTD/.test(up)) return 'pvt';
  if (/LIMITED\s+LIABILITY\s+PARTNERSHIP|\bLLP\b/.test(up)) return 'llp';
  if (/\bLIMITED\b|\bLTD\b/.test(up)) return 'public';
  if (/PROPRIET/.test(up)) return 'proprietorship';
  if (/PARTNERSHIP/.test(up)) return 'partnership';
  if (/HINDU UNDIVIDED|\bHUF\b|TRUST|SOCIETY|CO-?OPERATIVE|SELF HELP/.test(up)) return 'other';
  return '';
}

/* ------------------------------------------------------------ rules kit */
const ok = (text) => ({ ok: true, text });
const bad = (text) => ({ ok: false, text });
const info = (text) => ({ ok: null, text });
const no = (text, hide = false) => ({ match: 'no', why: [bad(text)], hide });

function context(p, a) {
  const nic = (p.nic || []).filter((n) => /^\d{5}$/.test(n.code));
  const traderNic = nic.length > 0 && nic.every((n) => [45, 46, 47].includes(+n.code.slice(0, 2)) || n.act === 'trading');
  const trader = p.activity === 'trading' || traderNic;
  const mfgNic = nic.some((n) => { const d = +n.code.slice(0, 2); return d >= 10 && d <= 33; });
  const mfg = !trader && (mfgNic || (nic.length === 0 && p.activity === 'manufacturing'));
  return {
    nic, nic5: nic.map((n) => n.code), nic4: nic.map((n) => n.code.slice(0, 4)), nic2: nic.map((n) => n.code.slice(0, 2)),
    trader, mfg,
    women: a.women === true,
    scst: p.social === 'sc' || p.social === 'st',
    ner: NER.has(p.state), himalayan: HIMALAYAN.has(p.state), island: ISLAND.has(p.state),
    neCg: NER.has(p.state) || p.state === 'Jammu and Kashmir' || p.state === 'Ladakh',
    hill: NER.has(p.state) || HIMALAYAN.has(p.state),
    corporate: ['pvt', 'public', 'llp'].includes(p.orgType),
    firm: ['partnership', 'llp', 'pvt', 'public'].includes(p.orgType),
    goals: new Set(a.goals || []), loan: a.loan || null,
    sizeL: SIZE_L[p.size] || 'MSME',
  };
}
function vishwakarmaMatch(codes) {
  for (const t of PMV_TRADES) { const c = codes.find((x) => t.main.includes(x)); if (c) return { ...t, code: c, strong: true }; }
  for (const t of PMV_TRADES) { const c = codes.find((x) => t.other.includes(x)); if (c) return { ...t, code: c, strong: false }; }
  return null;
}
function adeetieSector(c) {
  return ADEETIE.find((s) => (s.nic4 && c.nic4.some((x) => s.nic4.includes(x))) || (s.nic2 && c.nic2.some((x) => s.nic2.includes(x)))) || null;
}
function adeetieCluster(sec, p) {
  const d = String(p.district || '').toUpperCase().trim();
  const city = String(p.city || '').toUpperCase().trim();
  for (const cl of sec.clusters) {
    for (const alias of CLUSTER_DISTRICTS[cl] || []) {
      if (alias.startsWith('@')) { if (p.state === alias.slice(1)) return cl; }
      else if (alias === d || alias === city) return cl;
    }
  }
  return null;
}

/* --------------------------------------------------------- scheme rules */
const PROG = { open: 'Open', renewal: 'Open · renewal pending', deadline: 'Extension ended 30 Sep 2026', new: 'New' };

const SCHEMES = [
{
  id: 'cgtmse', name: 'Credit Guarantee Scheme for Micro and Small Enterprises', abbr: 'CGTMSE',
  agency: 'CGTMSE, set up by the Ministry of MSME and SIDBI', cat: 'Loans & credit', goals: ['credit', 'machinery'], weight: 10,
  prog: { s: 'open', note: 'Open, no end date. Ceiling raised to ₹10 crore for guarantees from 1 Apr 2025.' },
  apply: [['Through any bank or NBFC that is a CGTMSE member', 'https://www.cgtmse.in'], ['Online on JanSamarth', 'https://www.jansamarth.in']],
  docs: 'Udyam certificate, promoter KYC, financials or projections, bank statements, GST returns, category certificate if any.',
  src: [['CGTMSE circular 250, 18 Mar 2025', 'https://www.dcmsme.gov.in/Circular-No.2512024-25-reduction-in-AGF.pdf'], ['SBI: CGTMSE features', 'https://sbi.bank.in/web/business/sme/sme-government-schemes/cgtmse']],
  eval(p, c) {
    if (p.size === 'medium') return no('Covers micro and small enterprises only; you are Medium.');
    let cover = 75, basis = 'standard cover';
    if (c.women) { cover = 90; basis = 'woman-owned'; }
    else if (c.scst) { cover = 85; basis = 'SC/ST-owned'; }
    else if (p.size === 'micro' && c.loan === 'upto5l') { cover = 85; basis = 'micro loan up to ₹5 lakh'; }
    else if (c.neCg && (c.loan === 'upto5l' || c.loan === '5to20l')) { cover = 80; basis = 'your region, loan up to ₹50 lakh'; }
    const disc = ((c.women || c.scst) ? 10 : 0) + (c.neCg && c.loan !== '1to10cr' && c.loan !== 'above10cr' ? 10 : 0);
    const why = [ok(`${c.sizeL} enterprise`), ok('Manufacturing, services and trade are all covered')];
    if (c.women) why.push(ok('Woman-owned: 90% cover'));
    else if (c.scst) why.push(ok('SC/ST-owned: 85% cover'));
    let extra = '';
    if (cover === 75 && p.size === 'micro' && !c.loan) extra = ' Micro loans up to ₹5 lakh get 85%.';
    if (cover === 75 && c.neCg && !c.loan) extra += ' Units in the North-East, J&K and Ladakh get 80% up to ₹50 lakh.';
    let match = 'yes';
    if (c.loan === 'above10cr') { match = 'check'; why.push(bad('Your credit need is above the ₹10 crore ceiling; only part can be covered')); }
    return { match, why,
      headline: `Collateral-free loans up to ₹10 crore, ${cover}% guaranteed`,
      gets: [
        'Term loans and working capital up to ₹10 crore with no collateral or third-party guarantee.',
        `Guarantee cover for you: ${cover}% (${basis}).${extra}`,
        `Annual guarantee fee of 0.37% to 1.20% of the loan, rising with loan size.${disc ? ` You qualify for a ${disc}% fee discount (up to 30% with other categories, such as ZED certification).` : ' Discounts of 10% per category (women, SC/ST, North-East, aspirational district, ZED-certified) up to 30%.'} Your lender decides whether to pass the fee on.`,
      ],
      checks: ['Your loan account must not have been restructured or in SMA-2 stress in the past year.', 'The lender can take only the promoter’s personal guarantee for the covered part.'] };
  },
},
{
  id: 'mcc', name: 'Micro Credit Card for Micro Enterprises', abbr: 'Micro Credit Card',
  agency: 'Department of Financial Services; issued by banks with CGTMSE cover', cat: 'Loans & credit', goals: ['credit'], weight: 8,
  prog: { s: 'new', note: 'Launched 25 May 2026. Runs 3 years or until 10 lakh cards are issued.' },
  apply: [['Ask your bank branch, or apply on JanSamarth', 'https://www.jansamarth.in']],
  docs: 'Udyam certificate, promoter KYC, GSTIN or bank statements.',
  src: [['PIB: launch, 25 May 2026', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2265005'], ['Canara Bank: Micro Credit Card', 'https://www.canarabank.bank.in/canara-micro-credit-card']],
  eval(p, c) {
    if (p.size && p.size !== 'micro') return no(`Only for Udyam-registered micro enterprises; you are ${c.sizeL}.`);
    const big = c.loan && c.loan !== 'upto5l';
    return { match: 'yes', lowFit: big, why: [ok('Micro enterprise with Udyam registration'), ok('Any sector, for business spending'), ...(big ? [info('The ₹5 lakh limit is below the credit you need; useful for day-to-day spending')] : [])],
      headline: 'Business credit card with a limit of up to ₹5 lakh and no collateral',
      gets: ['Revolving working-capital limit up to ₹5 lakh on a RuPay card, backed by 75% CGTMSE cover, so no security is needed.', 'Up to 50 days interest-free at SBI; Canara Bank caps interest at 18% a year after the free period.', 'No joining fee for the first 10 lakh cards. Annual fee is at most 1% of the limit or ₹1,000, whichever is lower.'],
      checks: ['Business spending only; one card per enterprise.', 'Bank rules vary. Canara asks for a credit score above 650 (or no history) and no NPA or SMA status. SBI currently offers it to its own borrowers under government schemes.'] };
  },
},
{
  id: 'mudra', name: 'Pradhan Mantri MUDRA Yojana', abbr: 'PMMY / MUDRA',
  agency: 'Department of Financial Services; refinanced by MUDRA Ltd (SIDBI)', cat: 'Loans & credit', goals: ['credit'], weight: 8,
  prog: { s: 'open', note: 'Open, no end date.' },
  apply: [['Any bank, RRB, small finance bank, NBFC or MFI; or JanSamarth', 'https://www.jansamarth.in'], ['Udyami Mitra portal', 'https://www.udyamimitra.in']],
  docs: 'Application form, ID and address proof, bank statement, quotations or business proof, category certificate if any.',
  src: [['PIB: 11 years of PMMY, 8 Apr 2026', 'https://www.pib.gov.in/PressNoteDetails.aspx?NoteId=158056'], ['MUDRA', 'https://www.mudra.org.in']],
  eval(p, c) {
    if (p.size === 'medium') return no('MUDRA loans (up to ₹20 lakh) are for micro units; you are Medium.');
    if (['20lto1cr', '1to10cr', 'above10cr'].includes(c.loan)) return no('Your credit need is above the ₹20 lakh MUDRA limit.');
    const why = [];
    let match = 'yes';
    if (p.size === 'small') { match = 'check'; why.push(info('Meant mainly for micro units')); } else why.push(ok('Micro enterprise'));
    why.push(ok('Non-farm business in manufacturing, trading or services'));
    if (c.corporate) { match = 'check'; why.push(info('Aimed at individuals, proprietorships and partnerships; companies depend on the lender')); }
    const band = c.loan === 'upto5l' ? 'Shishu (up to ₹50,000) or Kishore (up to ₹5 lakh)' : c.loan === '5to20l' ? 'Tarun (up to ₹10 lakh), or Tarun Plus (up to ₹20 lakh) after repaying a Tarun loan' : '';
    return { match, why,
      headline: band ? `Collateral-free loan under ${band}` : 'Collateral-free business loans up to ₹20 lakh',
      gets: ['Four slabs: Shishu up to ₹50,000; Kishore up to ₹5 lakh; Tarun up to ₹10 lakh; Tarun Plus up to ₹20 lakh.', 'No collateral: loans are guaranteed by the Credit Guarantee Fund for Micro Units.', 'No subsidy; the lender sets the interest rate.'],
      checks: ['You must not be a defaulter with any bank.', 'Tarun Plus is only for borrowers who fully repaid an earlier Tarun loan.'] };
  },
},
{
  id: 'mcgs', name: 'Mutual Credit Guarantee Scheme for MSMEs', abbr: 'MCGS-MSME',
  agency: 'NCGTC, Department of Financial Services', cat: 'Machinery & upgrades', goals: ['machinery', 'credit', 'exports'], weight: 7,
  prog: { s: 'open', note: 'Open until about Jan 2029 or ₹7 lakh crore of guarantees. Revised 21 Mar 2026: services added, machinery share cut to 60%, exporter window added.' },
  apply: [['Through banks, NBFCs and all-India financial institutions', 'https://www.ncgtc.in']],
  docs: 'Udyam certificate, project report with machinery quotations, KYC, financial statements; export turnover proof for the exporter window.',
  src: [['PIB: MCGS-MSME changes, 21 Mar 2026', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2243388']],
  eval(p, c) {
    const why = [ok(p.size ? `${c.sizeL} enterprise (all MSME sizes qualify)` : 'Micro, small and medium all qualify')];
    let match = c.goals.has('machinery') ? 'yes' : 'check';
    if (c.trader) { match = 'check'; why.push(info('Covers manufacturing and services; ask your bank about trading units')); }
    else why.push(ok(p.activity === 'services' ? 'Services units covered since Mar 2026' : 'Manufacturing and services units covered'));
    if (!c.goals.has('machinery')) why.push(info('Only for loans to buy plant, machinery or equipment'));
    return { match, why,
      headline: 'Your lender gets a 60% guarantee on machinery loans up to ₹100 crore',
      gets: ['60% guarantee to the lender on loans up to ₹100 crore, and the lender cannot ask for collateral. The project itself can be larger.', 'Machinery or equipment must be at least 60% of the project cost.', 'Upfront contribution of 5% of the loan (max ₹5 crore), refunded at 1% a year from year 4 if the loan performs. Annual fee: nil in year 1, 1.5% in years 2 to 4, 1% after that.', 'Exporter window: units exporting at least 25% of turnover in each of the last 3 years can borrow up to ₹20 crore with 75% cover.'],
      checks: ['You must not be an NPA with any lender.', 'The loan must be for plant, machinery or equipment.'] };
  },
},
{
  id: 'pmegp', name: 'Prime Minister’s Employment Generation Programme', abbr: 'PMEGP',
  agency: 'Ministry of MSME, through KVIC, KVIBs and District Industries Centres', cat: 'Loans & credit', goals: ['credit', 'machinery'], weight: 5,
  prog: { s: 'open', note: 'Running in 2026-27 with ₹4,500 crore budgeted; formal approval for 2026–31 not yet published.' },
  apply: [['PMEGP e-portal', 'https://www.kviconline.gov.in/pmegpeportal/']],
  docs: 'Aadhaar, PAN, project report, caste or special-category certificate, education certificate, EDP training certificate.',
  src: [['KVIC: revised PMEGP guidelines, Dec 2023', 'https://www.kviconline.gov.in/pmegpeportal/dashboard/notification/Revised_PMEGP_Scheme_Guidelines_07122023_compressed.pdf']],
  eval(p, c) {
    if (p.size && p.size !== 'micro') return no(`PMEGP funds micro units only; you are ${c.sizeL}.`);
    if (c.firm) return no('PMEGP is for individuals (and SHGs, societies, co-operatives and trusts for new projects), not firms or companies.');
    const special = c.women || c.scst || p.social === 'obc' || c.hill;
    const up = c.hill ? 20 : 15;
    const why = [ok('Micro enterprise'), info('Upgrade loan only if your unit was set up with a PMEGP, REGP or MUDRA loan')];
    if (special) why.push(ok('Special category: higher subsidy on a new unit'));
    if (c.trader) why.push(info('Pure trading may not qualify'));
    return { match: 'check', why,
      headline: `Upgrade loan up to ₹1 crore with ${up}% subsidy, or ${special ? '25–35%' : '15–25%'} subsidy on a new unit`,
      gets: [`Second loan to upgrade an existing PMEGP, REGP or MUDRA unit: up to ₹1 crore (manufacturing) or ₹25 lakh (services), with ${up}% subsidy (max ${c.hill ? '₹20 lakh or ₹5 lakh' : '₹15 lakh or ₹3.75 lakh'}).`, `Setting up another new unit: projects up to ₹50 lakh (manufacturing) or ₹20 lakh (services) with ${special ? '25% (urban) or 35% (rural)' : '15% (urban) or 25% (rural)'} subsidy.`],
      checks: ['Upgrade loan: first loan repaid on time, earlier subsidy adjusted after its 3-year lock-in, and the unit is profitable.', 'New unit: applicant 18+, one per family, Class VIII pass for projects above ₹10 lakh (manufacturing) or ₹5 lakh (services), and EDP training before the subsidy is released.'] };
  },
},
{
  id: 'pmv', name: 'PM Vishwakarma', abbr: 'PM Vishwakarma',
  agency: 'Ministry of MSME; enrolment at Common Service Centres', cat: 'Artisans & trades', goals: ['credit', 'machinery', 'quality'], weight: 9, hideIfNo: true,
  prog: { s: 'open', note: 'Runs to FY2027-28. The 30 lakh registration target was met in Dec 2025, so confirm that new enrolment is open at your CSC.' },
  apply: [['Enrol at a Common Service Centre with Aadhaar biometrics', 'https://pmvishwakarma.gov.in']],
  docs: 'Aadhaar with linked mobile, bank account details, ration card or family details.',
  src: [['PIB: PM Vishwakarma, 16 Sep 2026', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2310717']],
  eval(p, c) {
    const hit = vishwakarmaMatch(c.nic5);
    if (!hit) return no('Covers 18 traditional trades; your NIC codes do not match them.', true);
    if (p.size && p.size !== 'micro') return no(`For individual self-employed artisans; you are ${c.sizeL}.`);
    if (c.firm) return no('For individual artisans, not firms or companies.');
    return { match: 'check',
      why: [ok(`NIC ${hit.code} ${hit.strong ? 'matches' : 'may match'} the ${hit.trade.toLowerCase()} trade`), info('Individual artisans only, one per family')],
      headline: `Toolkit worth ₹15,000 and loans of ₹1 lakh + ₹2 lakh at 5% for ${hit.who}`,
      gets: ['PM Vishwakarma certificate and ID card.', 'Skill training (5–7 days basic, 15+ days advanced) with a ₹500 a day stipend.', 'Toolkit e-voucher up to ₹15,000.', 'Collateral-free loans: ₹1 lakh over 18 months, then ₹2 lakh over 30 months, at 5% interest.', '₹1 per digital transaction (up to 100 a month) and help selling through GeM, e-commerce and trade fairs.'],
      checks: ['You must be 18+ and work in the trade yourself; no family member in government service.', 'No PMEGP, PM SVANidhi or MUDRA loan in the past 5 years (fully repaid MUDRA and SVANidhi loans are allowed).', 'Verification by the gram panchayat or urban body, then a district committee.'] };
  },
},
{
  id: 'pmfme', name: 'PM Formalisation of Micro Food Processing Enterprises', abbr: 'PMFME',
  agency: 'Ministry of Food Processing Industries, through state nodal agencies', cat: 'Food processing', goals: ['machinery', 'credit'], weight: 8, hideIfNo: true,
  prog: { s: 'deadline', note: 'The temporary extension ran to 30 Sep 2026, and no further extension or 2026–31 continuation had been announced by 1 Oct 2026. MoFPI has proposed a revised five-year scheme.' }, checked: '1 Oct 2026',
  apply: [['PMFME portal', 'https://pmfme.mofpi.gov.in']],
  docs: 'Aadhaar, PAN, bank statement, detailed project report, machinery quotations, land or rent papers.',
  src: [['Business Standard, 24 Aug 2026', 'https://www.business-standard.com/industry/news/pmfme-scheme-likely-to-get-extension-after-hitting-200-000-unit-target-126082400461_1.html'], ['MoFPI: PMFME guidelines', 'https://www.mofpi.gov.in/sites/default/files/pmfme_guidelines_english.pdf']],
  eval(p, c) {
    if (!c.nic2.includes('10')) return no('For food processing units (NIC division 10).', true);
    if (p.size && p.size !== 'micro') return no(`For micro food processing units; you are ${c.sizeL}.`);
    const why = [ok('Food processing NIC code'), ok('Micro enterprise'), bad('Extension ended 30 Sep 2026; renewal not yet announced')];
    if (c.corporate) why.push(info('Guidelines cover unincorporated units; companies reportedly allowed since 2022'));
    return { match: 'check', why,
      headline: '35% capital subsidy, up to ₹10 lakh, to upgrade your food unit',
      gets: ['35% credit-linked capital subsidy on the eligible project cost, up to ₹10 lakh.', 'You put in at least 10%; the rest is a bank loan.', 'A District Resource Person helps with the project report, the loan, and FSSAI, Udyam and GST registration.'],
      checks: ['Fewer than 10 workers; owner 18+ and one person per family.', 'Ask your state nodal agency whether new applications are accepted after 30 Sep 2026.'] };
  },
},
{
  id: 'nssh', name: 'National SC-ST Hub', abbr: 'NSSH + SCLCSS',
  agency: 'Ministry of MSME, implemented by NSIC', cat: 'SC/ST entrepreneurs', goals: ['machinery', 'credit', 'govt', 'quality', 'market'], weight: 9, hideIfNo: true,
  prog: { s: 'renewal', note: 'Operating, with ₹115 crore in the 2026-27 budget. Its approval ran to 31 Mar 2026 and a formal extension has not been notified yet.' },
  apply: [['National SC-ST Hub', 'https://www.scsthub.in'], ['Capital subsidy (SCLCSS) applications', 'https://sclcss.msme.gov.in']],
  docs: 'Udyam certificate, SC/ST certificate(s), shareholding proof for firms, loan sanction letter, machinery invoices.',
  src: [['PIB: National SC-ST Hub, 9 Jun 2026', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2270639'], ['Bank of India: SCLCSS', 'https://bankofindia.bank.in/govt-schemes/sclcss']],
  eval(p, c) {
    if (!c.scst) return no('For SC/ST-owned enterprises.', true);
    if (p.size === 'medium') return no('For micro and small enterprises; you are Medium.');
    const why = [ok(`${SOCIAL_L[p.social]}-owned enterprise`), ok(`${c.sizeL} enterprise`)];
    let match = 'yes';
    if (c.trader) { match = 'check'; why.push(info('Covers manufacturing and services; trading is unclear')); }
    if (c.firm || p.orgType === 'other') why.push(info('Firms need at least 51% SC/ST shareholding'));
    return { match, why,
      headline: '25% capital subsidy on machinery (up to ₹25 lakh) plus fee refunds',
      gets: ['SCLCSS: 25% of a term loan for plant, machinery or equipment, up to ₹25 lakh (eligible loan up to ₹1 crore).', 'NSIC Single Point Registration for government tenders, with the fee covered (you pay ₹100 + GST).', '80% refund, up to ₹1 lakh each, of testing fees, loan processing fees and performance guarantee charges.', '80% of e-commerce portal fees (up to ₹25,000), 90% of training fees at top institutes (up to ₹1 lakh), and support for 4 domestic and 2 international trade fairs a year.'],
      checks: ['The loan must come from an eligible bank or lending institution.'] };
  },
},
{
  id: 'adeetie', name: 'Assistance in Deploying Energy Efficient Technologies in Industries & Establishments', abbr: 'ADEETIE',
  agency: 'Bureau of Energy Efficiency, Ministry of Power', cat: 'Machinery & upgrades', goals: ['machinery', 'credit'], weight: 6,
  prog: { s: 'open', note: 'FY2025-26 to 2027-28; applications close 31 Mar 2028. 103 projects sanctioned by Aug 2026.' },
  apply: [['Scheme site (send the expression of interest to facilitation-centre@beeindia.gov.in)', 'https://adeetie.beeindia.gov.in']],
  docs: 'Udyam certificate, expression-of-interest form, energy bills, project report, loan sanction.',
  src: [['BEE: ADEETIE scheme', 'https://adeetie.beeindia.gov.in/adeetie-scheme']],
  eval(p, c) {
    const sec = adeetieSector(c);
    if (!sec) return no('Limited to 14 energy-intensive sectors.', true);
    const cl = adeetieCluster(sec, p);
    if (!cl) return no(`${sec.name} units qualify only in ${sec.clusters.join(', ')} for now. Your district is not listed; 100 more clusters are planned.`);
    const rate = p.size === 'medium' ? 3 : 5;
    return { match: 'check', why: [ok(`${sec.name} sector`), ok(`Your district falls in the ${cl} cluster`), info('Cluster list from a secondary compilation; confirm with BEE')],
      headline: `${rate}% interest subvention on energy-efficiency loans of ₹10 lakh to ₹15 crore`,
      gets: [`Interest subvention of ${rate}% a year for 3 years (5% for micro and small, 3% for medium).`, 'Free energy audit, detailed project report and monitoring.', 'Up to 75% of the project cost can be loan.'],
      checks: ['The project must cut energy use by at least 10% and keep it there.', 'Loan from a scheduled bank, public financial institution or NBFC; you must not be an NPA.'] };
  },
},
{
  id: 'zed', name: 'MSME Sustainable (ZED) Certification Scheme', abbr: 'ZED',
  agency: 'Ministry of MSME, with the Quality Council of India', cat: 'Certification & quality', goals: ['quality'], weight: 8,
  prog: { s: 'renewal', note: 'Running (9.49 lakh registered by Jul 2026). Guidelines ran to 31 Mar 2026; renewal for 2026–31 awaited.' },
  apply: [['ZED portal', 'https://zed.msme.gov.in']],
  docs: 'Udyam certificate; self-assessment photos of products, shop floor, labelling and fire safety; quality records for Silver and Gold.',
  src: [['ZED portal: subsidy on certification', 'https://zed.msme.gov.in'], ['PIB, 12 Mar 2026', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2238978']],
  eval(p, c) {
    if (c.trader) return no('Traders are not covered; ZED is for manufacturing units.');
    if (!c.mfg) return no('Covers manufacturing (NIC 10–33) only. A services version was announced in Aug 2026 but is not live yet.');
    const base = { micro: 80, small: 60, medium: 50 }[p.size] || 80;
    let pct = base;
    const why = [ok('Manufacturing unit'), ok(`${c.sizeL}: ${base}% subsidy`)];
    if (c.women) { pct = 100; why.push(ok('Woman-owned: 100% of certification cost')); }
    else if (c.scst || c.ner || c.himalayan || c.island) { pct = base + 10; why.push(ok(`Extra 10% for ${c.scst ? 'SC/ST ownership' : 'your region'}`)); }
    return { match: 'yes', why,
      headline: `Government pays ${pct}% of ZED certification; Bronze is effectively free`,
      gets: [`Certification fee: Bronze ₹10,000, Silver ₹40,000, Gold ₹90,000. You get ${pct}% subsidy.`, '₹10,000 joining reward after taking the ZED Pledge (valid 1 year), which covers Bronze.', 'After Bronze: 75% support (up to ₹50,000) for one testing or product certification, and up to ₹5 lakh of handholding.', 'ZED-certified units get 85% CGTMSE cover and a guarantee-fee discount; 19 banks and 22 states add their own incentives.'],
      checks: ['Certificates are valid for 3 years.', 'The extra 10% also applies in LWE-affected and aspirational districts, which this report does not check.'] };
  },
},
{
  id: 'lean', name: 'MSME Competitive (LEAN) Scheme', abbr: 'LEAN',
  agency: 'Ministry of MSME, with QCI and NPC', cat: 'Certification & quality', goals: ['quality'], weight: 6,
  prog: { s: 'renewal', note: 'Running (65,647 registered by May 2026). Guidelines ran to 31 Mar 2026; renewal awaited.' },
  apply: [['LEAN portal', 'https://lean.msme.gov.in']],
  docs: 'Udyam certificate; your 10% share of the fee for Intermediate or Advanced.',
  src: [['PIB, 26 Jun 2026', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2278107']],
  eval(p, c) {
    if (c.trader) return no('For manufacturing units; traders are not covered.');
    if (!c.mfg) return no('Covers manufacturing (NIC 10–33) only; services are planned for a later phase.');
    const share = 90 + (c.women || c.scst || c.ner ? 5 : 0);
    const why = [ok('Manufacturing unit')];
    if (share > 90) why.push(ok('Extra 5% government share for your profile'));
    return { match: 'yes', why,
      headline: `LEAN manufacturing consultancy with ${share}% paid by the government`,
      gets: ['Basic level: free, self-paced e-learning (about 2 months).', `Intermediate (fee cap ₹1.2 lakh + tax, 6 months) and Advanced (₹2.4 lakh + tax, 12 months): the government pays ${share}%.`, 'A LEAN consultant is assigned from the QCI and NPC panel.'],
      checks: ['Intermediate and Advanced need a group of enterprises, usually through an industry association or OEM.'] };
  },
},
{
  id: 'ppp', name: 'Public Procurement Policy for Micro and Small Enterprises', abbr: 'PPP-MSE + GeM',
  agency: 'Ministry of MSME; binds central ministries and CPSEs', cat: 'Selling to government', goals: ['govt', 'market'], weight: 9,
  prog: { s: 'open', note: 'Open. MSEs supplied 43.58% of central procurement in FY2024-25.' },
  apply: [['Register as a seller on GeM', 'https://gem.gov.in'], ['Central Public Procurement Portal', 'https://eprocure.gov.in']],
  docs: 'Udyam certificate (quote the number on every bid); SC/ST certificate or proof of women ownership if applicable.',
  src: [['DC-MSME: PPP FAQs', 'https://www.dcmsme.gov.in/FAQs-PPP_25032022.pdf']],
  eval(p, c) {
    if (p.size === 'medium') return no('Tender benefits apply to micro and small enterprises; you are Medium.');
    if (c.trader) return no('Traders, distributors and sole agents are excluded from tender benefits.');
    const why = [ok(`${c.sizeL} enterprise`), ok('Makes goods or provides services')];
    const gets = ['No earnest money deposit, and free tender documents, on central government tenders.', 'Quote within L1 + 15% and you can supply up to 25% of the order at the L1 price.', 'Central buyers must source 25% from MSEs; 358 items are reserved for MSEs.'];
    if (c.scst) { why.push(ok('SC/ST-owned: counts toward the 4% sub-target')); gets.push('4% of purchases are earmarked for SC/ST-owned MSEs.'); }
    if (c.women) { why.push(ok('Woman-owned: counts toward the 3% sub-target')); gets.push('3% of purchases are earmarked for women-owned MSEs.'); }
    gets.push('GeM seller fee: nil on orders up to ₹10 lakh, 0.30% up to ₹10 crore.');
    return { match: 'yes', why, headline: 'EMD exemption, free tenders and a purchase preference in government buying', gets,
      checks: ['Benefits apply only to items that match your Udyam NIC codes.', 'Quote your Udyam number on GeM or CPPP, or you are treated as a non-MSE bidder.', 'Performance guarantees still apply; joint ventures are not eligible.'] };
  },
},
{
  id: 'odr', name: 'Delayed payment protection under the MSMED Act', abbr: 'MSME ODR',
  agency: 'Ministry of MSME; state MSE Facilitation Councils', cat: 'Getting paid', goals: ['payments'], weight: 7,
  prog: { s: 'open', note: 'The ODR portal has been mandatory for new cases since 15 Oct 2025.' },
  apply: [['File on the MSME ODR portal', 'https://odr.msme.gov.in']],
  docs: 'Udyam certificate, purchase order, invoices, delivery proof, account statement.',
  src: [['PIB, 24 Jul 2026', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2288889']],
  eval(p, c) {
    if (p.size === 'medium') return no('Protection covers micro and small suppliers; you are Medium.');
    if (c.trader) return no('Traders are not covered by the delayed-payment rules.');
    return { match: 'yes', why: [ok(`${c.sizeL} supplier of goods or services`)],
      headline: 'Buyers must pay within 45 days or owe compound interest at 16.5% a year',
      gets: ['Buyers must pay by the agreed date, and no later than 45 days (15 days if there is no written agreement).', 'Late payments carry compound interest with monthly rests at 3× the RBI Bank Rate: 16.5% a year at today’s 5.50%.', 'Buyers can claim a tax deduction for dues to micro and small suppliers only in the year they actually pay (Income-tax Act 2025, s.37(2)(g), formerly s.43B(h)).', 'File a claim online; the council mediates and can pass an award.'],
      checks: ['Keep purchase orders, invoices and delivery proof for every sale.'] };
  },
},
{
  id: 'treds', name: 'Trade Receivables Discounting System', abbr: 'TReDS',
  agency: 'RBI-licensed platforms', cat: 'Getting paid', goals: ['payments', 'credit'], weight: 6,
  prog: { s: 'new', note: 'Open. New RBI TReDS Directions from 23 Jun 2026; CGTMSE cover on TReDS financing live since 22 Sep 2026.' },
  apply: [['RXIL', 'https://www.rxil.in'], ['M1xchange', 'https://www.m1xchange.com'], ['Invoicemart', 'https://www.invoicemart.com'], ['C2treds', 'https://www.c2treds.com']],
  docs: 'Udyam certificate, KYC, bank confirmation, debit mandate, platform agreement.',
  src: [['ANI: CGTMSE cover on TReDS goes live, 22 Sep 2026', 'https://aninews.in/news/business/msme-credit-guarantee-cover-goes-live-for-invoice-financing-on-treds20260922212507/']],
  eval(p, c) {
    const why = [ok('MSME sellers of all sizes can join')];
    let match = 'yes';
    if (c.trader) { match = 'check'; why.push(info('Trading sellers: confirm with the platform')); }
    const gets = ['Sell invoices your buyer has accepted to banks and NBFCs that bid for them, with no recourse to you.', 'Companies with turnover over ₹250 crore and all CPSEs must be on TReDS, and CPSEs must settle MSME invoices through it.'];
    if (p.size !== 'medium') gets.push('New: CGTMSE guarantee on TReDS financing for micro and small enterprises, live since 22 Sep 2026.');
    return { match, why, headline: 'Get paid on accepted invoices within days, at bank rates', gets,
      checks: ['Your buyer has to be on the same platform and accept the invoice.', 'Platforms charge registration and transaction fees.'] };
  },
},
{
  id: 'team', name: 'MSME Trade Enablement and Marketing', abbr: 'MSME TEAM',
  agency: 'Ministry of MSME, with NSIC and ONDC', cat: 'Marketing & online sales', goals: ['market'], weight: 5,
  prog: { s: 'open', note: 'Runs to 31 Mar 2027 (₹277 crore, target 5 lakh MSEs, half of them women-owned).' },
  apply: [['TEAM portal', 'https://team.msme.gov.in']],
  docs: 'Udyam certificate; GST registration to sell outside your state.',
  src: [['RAMP: TEAM guidelines', 'https://ramp.msme.gov.in']],
  eval(p, c) {
    if (p.size === 'medium') return no('For micro and small enterprises; you are Medium.');
    if (c.trader) return no('Traders are not covered.');
    return { match: 'yes', why: [ok(`${c.sizeL} enterprise`), info('Only if you are not already selling on ONDC')],
      headline: 'Start selling on ONDC with catalogue, delivery and packaging costs covered',
      gets: ['Catalogue creation up to ₹2,500 and account management up to ₹5,000, paid to your ONDC seller app.', 'Delivery ₹50 (B2C) or ₹200 (B2B) per order and packaging ₹20 or ₹250 per order, for 10 orders each.', 'Packaging design 20% up to ₹2,000, and ₹450 for digital marketing.'],
      checks: ['Use the benefits within 6 months of your first ONDC order; at least 2 orders must be delivered before a claim.', 'Without GST you can sell only within your state.'] };
  },
},
{
  id: 'pms', name: 'Procurement and Marketing Support Scheme', abbr: 'PMS',
  agency: 'Ministry of MSME, through DC-MSME and MSME-DFOs', cat: 'Marketing & online sales', goals: ['market'], weight: 5,
  prog: { s: 'renewal', note: 'Funded with ₹65 crore in 2026-27; renewal for 2026–31 awaited.' },
  applyFn: (p) => [[`Your MSME-DFO${p.dfo ? ` (${titleCase(p.dfo)})` : ''} or DC-MSME office`, 'https://www.dcmsme.gov.in']],
  docs: 'Udyam certificate, stall and fair receipts, travel tickets, GS1 or e-commerce fee receipts.',
  src: [['DC-MSME: PMS guidelines, Jul 2022', 'https://www.dcmsme.gov.in']],
  eval(p, c) {
    if (p.size === 'medium') return no('For micro and small enterprises; you are Medium.');
    if (c.trader) return no('Traders are not covered.');
    const full = c.women || c.ner;
    const gets = [`Domestic trade fairs: ${full ? '100%' : '80%'} of stall rent, plus 100% of travel, freight and publicity up to ₹25,000. Up to ₹1.5 lakh per fair in metros (₹0.8 lakh elsewhere), 2 fairs a year.`];
    if (p.size !== 'small') gets.push('GS1 barcodes: 80% of the one-time fee and the first 3 years of annual fees (max ₹50,650).', 'E-commerce onboarding: 75% of fees, up to ₹25,000.');
    const why = [ok(`${c.sizeL} enterprise`)];
    if (full) why.push(ok(`${c.women ? 'Woman-owned' : 'North-East'}: 100% stall rent`));
    return { match: 'yes', why,
      headline: `${full ? 'Full' : '80%'} stall-rent refund at trade fairs${p.size !== 'small' ? ', plus barcode and e-commerce fee support' : ''}`, gets,
      checks: ['Only fairs organised by DC-MSME, NSIC, KVIC, the Coir Board, state governments or central ministries count.'] };
  },
},
{
  id: 'vbry', name: 'PM Viksit Bharat Rozgar Yojana, employer incentive', abbr: 'PM-VBRY',
  agency: 'Ministry of Labour & Employment, through EPFO', cat: 'Hiring', goals: ['hiring'], weight: 6, onlyGoal: 'hiring',
  prog: { s: 'open', note: 'For jobs created from 1 Aug 2025 to 31 Jul 2027.' },
  apply: [['PM-VBRY portal (EPFO)', 'https://pmvbry.epfindia.gov.in']],
  docs: 'EPFO establishment code, PAN-linked bank account, monthly PF returns, employee UANs.',
  src: [['PIB: scheme approval, 1 Jul 2025', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2141129'], ['EPFO: PM-VBRY FAQ', 'https://pmvbry.epfindia.gov.in/faq/']],
  eval(p, c) {
    const yrs = c.mfg ? 4 : 2;
    const why = [ok('Any sector and size'), info('Needs EPFO registration and net new hiring')];
    if (c.mfg) why.push(ok('Manufacturing: paid for 4 years instead of 2'));
    return { match: 'check', why,
      headline: `Up to ₹3,000 a month for each extra employee, for ${yrs} years`,
      gets: ['Per extra employee per month: up to ₹1,000 (EPF wage up to ₹10,000), ₹2,000 (₹10,001–20,000) or ₹3,000 (₹20,001 to ₹1 lakh).', c.mfg ? 'Paid for 48 months because you are in manufacturing.' : 'Paid for 24 months (48 months for manufacturing).'],
      checks: ['Hire at least 2 more people than your baseline (5 if you have 50 or more employees), and keep each for 6+ months.', 'New hires must join between 1 Aug 2025 and 31 Jul 2027, earn up to ₹1 lakh a month gross, and have Aadhaar-verified UANs.', 'You must be registered with EPFO and filing monthly PF returns.'] };
  },
},
{
  id: 'epm', name: 'Export Promotion Mission (Niryat Protsahan)', abbr: 'EPM',
  agency: 'Department of Commerce and DGFT; CGTMSE and banks', cat: 'Exports', goals: ['exports', 'credit'], weight: 6, onlyGoal: 'exports',
  prog: { s: 'open', note: 'Approved Nov 2025 for FY2025-26 to 2030-31. Interest subvention and collateral support have run as pilots since Jan 2026.' },
  apply: [['DGFT: Export Promotion Mission (apply through your bank)', 'https://www.dgft.gov.in/CP/?opt=export-promotion-mission']],
  docs: 'IEC, Udyam certificate, export credit sanction, shipping documents.',
  src: [['PIB: mission approved, 12 Nov 2025', 'https://www.pib.gov.in/PressReleseDetailm.aspx?PRID=2189381']],
  eval(p, c) {
    const cover = p.size === 'medium' ? 65 : 85;
    return { match: 'check', why: [ok('Micro, small and medium exporters'), info('Depends on your IEC and your product’s HS code being on the list')],
      headline: `2.75% interest subvention on export credit, and ${cover}% collateral-free cover`,
      gets: ['Interest subvention of 2.75% a year on pre- and post-shipment rupee export credit, passed on upfront by your bank (cap of ₹50 lakh per exporter in FY2025-26).', `Collateral support: a CGTMSE guarantee of ${cover}% on export working capital, up to ₹10 crore per exporter per year.`, 'Market access and branding support through export promotion councils.'],
      checks: ['You need a valid Importer-Exporter Code (IEC).', 'Your product must be on the notified list of about 4,139 HS lines.', 'Generate a unique ID on the DGFT portal for each credit facility.'] };
  },
},
{
  id: 'cbfte', name: 'Capacity Building of First-Time MSE Exporters', abbr: 'IC-CBFTE',
  agency: 'Ministry of MSME, with Export Promotion Councils and ECGC', cat: 'Exports', goals: ['exports'], weight: 5, onlyGoal: 'exports',
  prog: { s: 'open', note: 'Active under the merged SPIC scheme in 2026-27.' },
  apply: [['International Cooperation portal, or your Export Promotion Council', 'https://ic.msme.gov.in']],
  docs: 'Udyam certificate, IEC, RCMC, form ANF-2C, export proof, premium and test invoices.',
  src: [['CEPC: CBFTE reimbursement', 'https://cepc.co.in/cbfte-scheme-reimbursement-of-rcmc-fee']],
  eval(p, c) {
    if (p.size === 'medium') return no('For micro and small first-time exporters; you are Medium.');
    return { match: 'check', why: [ok(`${c.sizeL} enterprise`), info('Only if your IEC is at most 3 years old on the shipment date')],
      headline: 'Refunds on RCMC, export insurance and testing for first-time exporters',
      gets: ['RCMC fee: 75%, up to ₹20,000.', 'Export credit insurance premium: up to ₹10,000 a year.', 'Export testing and quality certification: 75%, up to ₹1 lakh (max 3 a year).'],
      checks: ['The export shipment must be in the same financial year as the claim.', 'The Ministry’s 2025-26 booklet quotes 80% for some items; confirm the current rate.'] };
  },
},
{
  id: 'ipr', name: 'MSME Innovative Scheme (IPR, Design, Incubation)', abbr: 'MSME Innovative',
  agency: 'Ministry of MSME, through IP Facilitation Centres', cat: 'Patents & design', goals: ['ip', 'quality'], weight: 5, onlyGoal: 'ip',
  prog: { s: 'renewal', note: 'Running (3,143 IPR reimbursements by Feb 2026); renewal for 2026–31 awaited.' },
  apply: [['MSME Innovative portal', 'https://innovative.msme.gov.in']],
  docs: 'Udyam certificate, IP registration certificate, original bills, bank mandate, declaration of no other funding.',
  src: [['PIB, 12 Mar 2026', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2238978']],
  eval(p, c) {
    if (c.trader) return no('Traders are generally not covered.');
    const design = p.size === 'micro' ? '75%' : p.size ? '60%' : '75% (micro) or 60%';
    return { match: 'yes', why: [ok('Any MSME with Udyam, any sector'), info('Paid after the IP is granted or registered')],
      headline: 'Refunds for patents (₹1–5 lakh), trademarks (₹10,000) and GI (₹2 lakh)',
      gets: ['100% of actual cost up to: foreign patent ₹5 lakh, Indian patent ₹1 lakh, GI ₹2 lakh, design ₹15,000, trademark ₹10,000.', '70% support for foreign trademarks or designs (up to ₹1.5 lakh) and for licensing in patents (up to ₹10–15 lakh).', `Design projects: ${design} of cost, up to ₹40 lakh.`, 'Incubation: up to ₹15 lakh per idea through a host institute.'],
      checks: ['One claim per IP asset, and no other government funding for the same IP.'] };
  },
},
{
  id: 'sri', name: 'Self-Reliant India Fund', abbr: 'SRI Fund',
  agency: 'Ministry of MSME; NSIC Venture Capital Fund, managed by SBICAP Ventures', cat: 'Growth capital', goals: ['equity'], weight: 4, onlyGoal: 'equity',
  prog: { s: 'open', note: 'Active; ₹2,000 crore added in Budget 2026-27.' },
  apply: [['Approach an empanelled daughter fund (list at NVCFL)', 'https://www.nvcfl.co.in']],
  docs: 'Udyam certificate, 3 years of audited accounts, business plan and projections.',
  src: [['PIB: Standing Committee report, 11 Mar 2026', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2238242']],
  eval(p, c) {
    const why = [ok('Any MSME with Udyam; manufacturing, services and agriculture')];
    why.push(c.corporate ? ok('Company or LLP structure can take equity') : info('Funds invest in companies (and some LLPs); a proprietorship or partnership would need to restructure'));
    return { match: 'check', why,
      headline: 'Growth equity from 69 venture funds backed by a ₹50,000 crore fund of funds',
      gets: ['Equity or quasi-equity growth capital through SEBI-registered daughter funds.', '₹16,260 crore invested in 693 MSMEs so far (Mar 2026).'],
      checks: ['Funds look at your growth over the last 3 years and do their own due diligence.', 'This is investment, not a grant: you give up a share of the business.'] };
  },
},
];

const WATCH = [
  { when: (p, c) => c.women || c.scst, name: 'Term loans up to ₹2 crore for first-time women, SC and ST entrepreneurs', status: 'Announced, not launched',
    text: 'Announced in Budget 2025-26 for 5 lakh first-time entrepreneurs, to replace Stand-Up India, which closed on 31 Mar 2025. In Mar 2026 the Finance Minister said it is being redrafted. Relevant if you start a new venture.',
    src: ['Business Standard, 16 Mar 2026', 'https://www.business-standard.com/industry/news/govt-to-soon-come-out-with-revamped-stand-up-india-scheme-sitharaman-126031600737_1.html'] },
  { when: (p, c) => p.size === 'small' || p.size === 'medium' || c.goals.has('equity'), name: 'SME Growth Fund (₹10,000 crore)', status: 'Announced, not launched',
    text: 'Announced in Budget 2026-27 to back enterprises with the potential to become "future champions". No guidelines yet.',
    src: ['PIB: Budget 2026-27 for MSMEs', 'https://www.pib.gov.in/PressNoteDetails.aspx?NoteId=157367&ModuleId=3&reg=3&lang=1'] },
  { when: (p, c) => p.activity === 'services' && !c.mfg && !c.trader, name: 'ZED certification for services', status: 'Announced Aug 2026',
    text: 'The ministry announced a services version of ZED; QCI and NPC are still developing the parameters.', src: ['ZED portal', 'https://zed.msme.gov.in'] },
  { when: (p, c) => c.goals.has('exports'), name: 'Credit Guarantee Scheme for Exporters', status: 'Closed 31 Mar 2026',
    text: 'Gave exporters extra working capital with a 100% guarantee. Open alternatives: the Export Promotion Mission and the MCGS-MSME exporter window.',
    src: ['PIB, 12 Nov 2025', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2189389'] },
  { when: (p, c) => (p.size === 'micro' || p.size === 'small') && !c.trader, name: 'MSMED (Amendment) Act, 2026', status: 'Passed Aug 2026, not yet in force',
    text: 'Sets time limits for payment disputes (mediation within 90 days, award within 90 days) and makes courts release at least half of an award under challenge. Applies once the government notifies it.', src: null },
];

/* ------------------------------------- state, sector, export and startup data */
// Data lives in src/data/states.json and src/data/extras.json, so the monthly rule check can
// update it without touching the code (see scripts/sync-from-artifact.mjs).
const STATE_DATA = statesData && Array.isArray(statesData.states) ? statesData : { checked: VERIFIED, states: [] };
const EXTRA_DATA = extrasData && Array.isArray(extrasData.items) ? extrasData : { checked: VERIFIED, items: [] };
const CHECKED = STATE_DATA.checked || VERIFIED;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const iso = (s) => { const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(s || '')); return m ? new Date(+m[1], (+m[2] || 1) - 1, +(m[3] || 1)) : null; };
const fmtD = (d) => (d ? `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` : '');
const fmtM = (d) => (d ? `${MON[d.getMonth()]} ${d.getFullYear()}` : '');
function checkedText() {
  if (VERIFIED === CHECKED) return CHECKED;
  const a = VERIFIED.split(' '), b = CHECKED.split(' ');
  return a[1] === b[1] && a[2] === b[2] ? `${a[0]}–${CHECKED}` : `${VERIFIED} and ${CHECKED}`;
}
GOALS.push(['startup', 'Startup (DPIIT) benefits']);

const ST_BY_NAME = new Map(STATE_DATA.states.map((s) => [s.state, s]));
const ITYPE_L = {
  capital_subsidy: 'Capital subsidy', interest_subsidy: 'Interest subsidy', sgst_refund: 'SGST refund', stamp_duty: 'Stamp duty',
  electricity_duty: 'Electricity duty', power_tariff: 'Power tariff', employment: 'Employment', quality_tech: 'Quality and technology',
  marketing: 'Marketing and exports', land: 'Land', women_scst: 'Special categories', other: 'Other support',
};
const CONF_L = { medium: 'Secondary source', low: 'Not verified' };
const STATE_DOCS = 'Udyam certificate, project report and proof of investment, bank sanction for loan-linked items, and the state claim form. The District Industries Centre confirms the list.';
const sizeList = (a) => { const l = a.map((s) => SIZE_L[s].toLowerCase()); return l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0]; };
const actList = (a) => { const l = a.map((s) => ACT_L[s].toLowerCase()); return l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0]; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'source'; } };

function extraMatch(text, c, type) {
  const t = String(text || '');
  if (!t) return null;
  if (c.women && type !== 'employment' && /\bwom[ae]n/i.test(t) && !/\b(female|wom[ae]n) (workers|employees|staff)\b/i.test(t)) return 'Higher rates for women-owned units may apply to you (see the details)';
  if (c.scst && /\bSC\b|\bST\b|SC\/ST|SC-ST|Scheduled (Caste|Tribe)/.test(t)) return 'Higher rates for SC/ST owners may apply to you (see the details)';
  if ((c.ner || c.himalayan || c.island) && /North[- ]East|\bNE\b|Himalayan|hill|island/i.test(t)) return 'Higher rates for your region may apply (see the details)';
  return null;
}
function stateStatus(rec) {
  let st = rec.st;
  if (st === 'opens' && rec.start && TODAY >= iso(rec.start)) st = 'open';
  if (st === 'expiring' && rec.until && TODAY > iso(rec.until)) st = 'lapsed';
  const label = {
    open: 'In force', expiring: `In force to ${fmtD(iso(rec.until))}`, opens: `Opens ${fmtD(iso(rec.start))}`, lapsed: 'Extension ended',
    pending: 'Applications closed', draft: 'Draft only', notoperational: 'Not yet running', unverified: 'Terms unverified', none: 'No state scheme',
  }[st] || st;
  const note = st === 'lapsed' ? `The extension to ${fmtD(iso(rec.until))} has passed; check whether the new policy is out.` : '';
  return { st, label, note, live: st === 'open' || st === 'expiring' || st === 'opens' };
}
function onlyCheck(it, p, c, a) {
  const t = it.onlyText || 'Only for specific owner groups';
  const socialKnown = !!p.social, womenKnown = a.women === true || a.women === false;
  switch (it.only) {
    case 'scst': return c.scst ? ['ok', 'SC/ST-owned'] : socialKnown ? ['no', t] : ['check', t];
    case 'st': return p.social === 'st' ? ['ok', 'ST-owned'] : socialKnown ? ['no', t] : ['check', t];
    case 'women_or_scst': return c.women ? ['ok', 'Woman-owned'] : c.scst ? ['ok', 'SC/ST-owned'] : (socialKnown && womenKnown) ? ['no', t] : ['check', t];
    case 'special': return c.women ? ['ok', 'Woman-owned'] : c.scst ? ['ok', 'SC/ST-owned'] : ['check', t];
    case 'women_or_other': return c.women ? ['ok', 'Woman-owned'] : ['check', t];
    case 'other': case 'group': return ['check', t];
    default: return null;
  }
}
function evalStateItem(it, rec, ss, p, c, a) {
  const why = [];
  let match = 'yes', lowFit = false;
  const soft = (w) => { why.push(w); if (match === 'yes') match = 'check'; };
  if (p.size) {
    if (!it.sizes.includes(p.size)) return no(`For ${sizeList(it.sizes)} units; you are ${c.sizeL}.`);
    why.push(ok(`${c.sizeL} enterprise`));
  }
  const act = c.trader ? 'trading' : p.activity;
  if (act) {
    if (!it.activities.includes(act)) return no(`Covers ${actList(it.activities)} only; your main activity is ${ACT_L[act].toLowerCase()}.`);
    why.push(ok(`${ACT_L[act]} is covered`));
  } else soft(info('Main activity not set'));
  const on = onlyCheck(it, p, c, a);
  if (on) {
    if (on[0] === 'no') return no(`${on[1]}.`);
    if (on[0] === 'ok') why.push(ok(on[1]));
    else { soft(info(on[1])); if (it.only === 'other' || it.only === 'group') lowFit = true; }
  }
  const com = toDate(p.commenced), since = iso(rec.since);
  if (it.unit === 'any') {
    if (it.minCommenced) {
      const md = iso(it.minCommenced);
      if (com && com < md) return no(`For enterprises started on or after ${fmtD(md)}; yours started in ${fmtM(com)}.`);
      if (com) why.push(ok(`Started ${fmtM(com)}, after ${fmtD(md)}`)); else soft(info(`Only for enterprises started on or after ${fmtD(md)}`));
    } else why.push(ok('Existing units can claim'));
  } else if (it.unit === 'existing') {
    const lim = iso(it.existingBefore);
    if (com && com > lim) return no(`Only for units GST-registered in ${rec.state} by ${fmtD(lim)}; yours started in ${fmtM(com)}.`);
    soft(info(`Only for units GST-registered in ${rec.state} by ${fmtD(lim)}`));
  } else if (since && com && com >= since) {
    why.push(ok(`Started ${fmtM(com)}, after this policy began (${fmtM(since)}), so it can count as a new unit`));
  } else if (since && com) {
    if (it.unit === 'new') return no(`Only for new units set up under this policy (from ${fmtM(since)}); yours started in ${fmtM(com)}.`);
    soft(info(it.unit === 'newexp'
      ? `Your unit started before this policy (${fmtM(since)}), so only an expansion or diversification project qualifies`
      : `Unclear whether units started before this policy (${fmtM(since)}) can claim; ask the DIC`));
  } else {
    soft(info(it.unit === 'new' ? 'For new units; ask the DIC whether yours counts'
      : it.unit === 'newexp' ? 'For new units, and for expansion or diversification projects'
      : 'For new units; whether existing units can claim is unclear'));
  }
  if (it.scope) soft(info(it.scope));
  if (rec.servicesListed && act === 'services' && it.activities.includes('services')) soft(info(`Services qualify only if your activity is on ${rec.state}'s approved list`));
  if (it.confidence === 'low') soft(info('Figures not confirmed against the official policy text; confirm with the DIC'));
  if (ss.st === 'opens') soft(info(`This policy takes effect on ${fmtD(iso(rec.start))}`));
  if (ss.st === 'expiring') why.push(info(`The policy is extended only to ${fmtD(iso(rec.until))}; a new one is expected`));
  const ex = it.only ? null : extraMatch(it.extraFor, c, it.type);
  if (ex) why.push(ok(ex));
  return {
    match, why, lowFit, headline: it.summary,
    gets: [...it.details, ...(it.extraFor && !it.only ? [`Higher support: ${it.extraFor}`] : [])],
    checks: it.conditions.length ? it.conditions : ['Your District Industries Centre confirms the conditions.'],
  };
}
function stateAdapter(rec, it, i, ss) {
  return {
    id: `st-${rec.code}-${i}`, name: it.name, abbr: '', agency: rec.short, cat: ITYPE_L[it.type] || 'State support', goals: it.goals, weight: 0,
    prog: { s: ss.st === 'opens' ? 'new' : ss.st === 'expiring' ? 'renewal' : 'open', label: ss.label, note: `${ss.label}${rec.period ? ` (${rec.period})` : ''}; ${rec.short}.` },
    apply: [it.apply || [rec.portal.label, rec.portal.url]], docs: STATE_DOCS,
    src: [[hostOf(it.source), it.source]], checked: rec.checked || CHECKED, conf: it.confidence, state: true,
  };
}
function evalState(p, a, c) {
  const rec = ST_BY_NAME.get(p.state);
  if (!rec) return { rec: null, yes: [], check: [], nofit: [], ref: [] };
  const ss = stateStatus(rec);
  const out = { rec, ss, yes: [], check: [], nofit: [], ref: [] };
  if (!ss.live) { out.ref = rec.items; return out; }
  const pe = p.size ? p : { ...p, size: 'micro' };
  const ce = p.size ? c : context(pe, a);
  rec.items.forEach((it, i) => {
    let r;
    try { r = evalStateItem(it, rec, ss, pe, ce, a); } catch (e) { console.error(rec.code, i, e); return; }
    if (!p.size && r.match === 'yes') { r.match = 'check'; r.why.unshift(info('Category missing; assumed Micro')); }
    const x = { s: stateAdapter(rec, it, i, ss), r, goalHit: !r.lowFit && it.goals.some((g) => c.goals.has(g)), conf: it.confidence };
    (r.match === 'yes' ? out.yes : r.match === 'check' ? out.check : out.nofit).push(x);
  });
  const rank = { high: 0, medium: 1, low: 2 };
  const order = (x, y) => (y.goalHit - x.goalHit) || ((x.r.lowFit ? 1 : 0) - (y.r.lowFit ? 1 : 0)) || (rank[x.conf] - rank[y.conf]);
  out.yes.sort(order); out.check.sort(order);
  return out;
}

/* ---------------------------------------------- sector, export and startup extras */
const ORG_MAP = {
  proprietorship: ['proprietorship', 'individual'], partnership: ['partnership'], llp: ['llp'], pvt: ['pvt', 'company'], public: ['company', 'public'],
  other: ['other', 'cooperative', 'society', 'trust', 'shg', 'fpo', 'producer company', 'section 8 company', 'ngo', 'jlg', 'spv', 'psu/jv'],
};
const ORGX_L = {
  pvt: 'private limited companies', partnership: 'registered partnerships', llp: 'LLPs', other: 'co-operative societies', individual: 'individuals',
  shg: 'self-help groups', cooperative: 'co-operatives', 'producer company': 'producer companies', fpo: 'FPOs', 'section 8 company': 'Section 8 companies',
  spv: 'cluster SPVs', society: 'societies', trust: 'trusts', proprietorship: 'proprietorships', company: 'companies', ngo: 'NGOs', 'psu/jv': 'PSUs and JVs',
  jlg: 'joint liability groups', public: 'public limited companies',
};
const orgList = (a) => { const l = [...new Set(a.map((o) => ORGX_L[o] || o))]; return l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0]; };
function xStatus(x) {
  const s = String(x.status || '').toLowerCase().trim();
  let m;
  if (s === 'open') return { live: true, s: 'open', label: 'Open' };
  if (s.startsWith('open')) return { live: true, s: 'renewal', label: 'Open · renewal pending' };
  if ((m = /^closing (\d{4}-\d{2}-\d{2})/.exec(s))) {
    const d = iso(m[1]);
    return TODAY <= d ? { live: true, s: 'deadline', label: `Closes ${fmtD(d)}` } : { live: false, closed: d, label: `Closed ${fmtD(d)}` };
  }
  if ((m = /^closed (\d{4}(?:-\d{2}-\d{2})?)/.exec(s))) return { live: false, closed: iso(m[1]), label: m[1].length === 4 ? `Closed in ${m[1]}` : `Closed ${fmtD(iso(m[1]))}` };
  if (s.startsWith('announced')) return { live: false, announced: true, label: 'Announced, not launched' };
  return { live: false, label: x.status };
}
function xNicHit(x, c) {
  const n2 = x.nic2 || [], n4 = x.nic4 || [], n5 = x.nic5 || [];
  if (!n2.length && !n4.length && !n5.length) return { gated: false, code: null };
  const code = c.nic5.find((v) => n5.includes(v) || n4.includes(v.slice(0, 4)) || n2.includes(v.slice(0, 2)));
  return { gated: true, code: code || null };
}
function xGate(x, p, c) {
  if (x.states && x.states.length && !x.states.includes(p.state)) return 'drop';
  const n = xNicHit(x, c);
  if (n.gated && !n.code) return 'drop';
  if (x.groupOnly && p.orgType !== 'other') return 'group';
  if (x.strictGoal && !c.goals.has(x.strictGoal)) return x.strictGoal;
  return 'ok';
}
function xEval(x, p, c) {
  const why = [];
  let match = 'yes';
  const soft = (w) => { why.push(w); if (match === 'yes') match = 'check'; };
  const hide = !!x.hideIfNo;
  if (p.size) {
    if (!x.sizes.includes(p.size)) return no(`For ${sizeList(x.sizes)} enterprises; you are ${c.sizeL}.`, hide);
    why.push(ok(`${c.sizeL} enterprise`));
  }
  const act = c.trader ? 'trading' : p.activity;
  if (act && !x.activities.includes(act)) return no(`Covers ${actList(x.activities)} only; your main activity is ${ACT_L[act].toLowerCase()}.`, hide);
  const n = xNicHit(x, c);
  if (n.code) why.push(ok(`Your NIC code ${n.code} is in this sector`));
  if (x.states && x.states.length) why.push(ok(`Available in ${p.state}`));
  const orgs = (x.orgTypes || ['any']).map((o) => String(o).toLowerCase());
  if (!orgs.includes('any')) {
    const list = orgList(orgs);
    if (!p.orgType) soft(info(`Open to ${list}`));
    else if (ORG_MAP[p.orgType].some((o) => orgs.includes(o))) {
      if (p.orgType === 'other') soft(info(`Open to ${list}; check that your organisation type qualifies`));
      else why.push(ok(`${ORG_L[p.orgType]} can apply`));
    } else return no(`Open to ${list}; you are a ${ORG_L[p.orgType].toLowerCase()}.`, hide);
  }
  if (x.maxAgeYears) {
    const d = toDate(p.incorporated) || toDate(p.commenced);
    if (d) {
      const yrs = (TODAY - d) / (365.25 * 864e5);
      if (yrs > x.maxAgeYears) return no(`For businesses up to ${x.maxAgeYears} years old; yours dates from ${d.getFullYear()}.`, hide);
      why.push(ok(`Within the ${x.maxAgeYears}-year age limit (since ${d.getFullYear()})`));
    } else soft(info(`Only for businesses up to ${x.maxAgeYears} years old`));
  }
  if (x.groupOnly) soft(info('For a group of units, cluster SPV or co-operative, not a single unit'));
  if (x.scope) soft(info(x.scope));
  if (x.confidence === 'low') soft(info('Details not fully confirmed; check with the agency'));
  if (x.fit === 'check' || x.kind !== 'sector' || !n.gated) { if (match === 'yes') match = 'check'; }
  const ex = extraMatch(x.extraFor, c);
  if (ex) why.push(ok(ex));
  if (!why.some((w) => w.ok === null) && match === 'check') why.push(info(x.kind === 'export' ? 'Depends on your export plans and the paperwork listed below' : x.kind === 'startup' ? 'Needs DPIIT startup recognition first' : 'Depends on the project and conditions below'));
  return {
    match, why, lowFit: !!x.lowFit, headline: x.headline,
    gets: [...(x.gets || []), ...(x.extraFor ? [`Higher support: ${x.extraFor}`] : [])],
    checks: [...(x.needs ? [`You need: ${x.needs}`] : []), ...(x.checks || [])],
  };
}
const EXTRAS = EXTRA_DATA.items.map((x) => {
  const st = xStatus(x);
  return {
    id: 'x-' + x.id, name: x.name, abbr: x.abbr, agency: x.agency, cat: x.cat, goals: x.goals || [], weight: x.weight || 5,
    prog: { s: st.s || 'open', label: st.label, note: x.statusNote }, apply: [[x.apply.label, x.apply.url]], docs: x.docs,
    src: [[x.source.label, x.source.url]], checked: x.checked || EXTRA_DATA.checked || CHECKED, conf: x.confidence, raw: x, st,
    gate: (p, c) => xGate(x, p, c), eval: (p, c) => xEval(x, p, c),
  };
});
function extraWatch(p, c) {
  const out = [];
  const cutoff = iso('2025-01-01');
  for (const e of EXTRAS) {
    const x = e.raw;
    if (e.st.live || x.groupOnly) continue;
    const g = xGate(x, p, c);
    if (g === 'drop' || g === 'group') continue;
    if (x.strictGoal && g !== 'ok' && !state.showAll) continue;
    if (e.st.closed && e.st.closed < cutoff) continue;
    if (p.size && !x.sizes.includes(p.size)) continue;
    out.push({ name: x.name, status: e.st.label, text: `${x.headline}. ${x.statusNote}`, src: [x.source.label, x.source.url] });
  }
  return out;
}
const HID_L = { exports: ['export benefit', 'export benefits'], startup: ['startup benefit', 'startup benefits'], group: ['cluster scheme', 'cluster schemes'] };
function hiddenSummary(hidden) {
  const by = new Map();
  for (const x of hidden) { const k = x.hid || 'other'; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  const parts = [];
  for (const [k, list] of by) {
    if (HID_L[k] && list.length > 1) parts.push(`${list.length} ${HID_L[k][1]}`);
    else parts.push(...list.map((x) => x.s.abbr));
  }
  return { parts, group: by.has('group') };
}

{ const v = document.querySelector('.verified'); if (v) v.innerHTML = '<i></i>Rules checked ' + esc(checkedText()); }

/* --------------------------------------------------------- evaluation */
function evaluate() {
  const p = state.profile, a = state.answers;
  const c = context(p, a);
  const pe = p.size ? p : { ...p, size: 'micro' };
  const ce = p.size ? c : context(pe, a);
  const yes = [], check = [], nofit = [], hidden = [];
  const add = (s, r, gate) => {
    if (!p.size && r.match === 'yes') { r.match = 'check'; r.why.unshift(info('Category missing; assumed Micro')); }
    const x = { s, r, goalHit: !r.lowFit && s.goals.some((g) => c.goals.has(g)) };
    if (r.match === 'no') { if (!r.hide && gate === 'ok') nofit.push(x); return; }
    if (gate !== 'ok' && !state.showAll) { x.hid = gate; hidden.push(x); return; }
    (r.match === 'yes' ? yes : check).push(x);
  };
  for (const s of SCHEMES) {
    let r;
    try { r = s.eval(pe, ce); } catch (e) { console.error(s.id, e); continue; }
    add(s, r, c.goals.size && s.onlyGoal && !c.goals.has(s.onlyGoal) ? s.onlyGoal : 'ok');
  }
  for (const s of EXTRAS) {
    if (!s.st.live) continue;
    const gate = s.gate(p, c);
    if (gate === 'drop') continue;
    let r;
    try { r = s.eval(pe, ce); } catch (e) { console.error(s.id, e); continue; }
    add(s, r, gate);
  }
  const order = (x, y) => (y.goalHit - x.goalHit) || (y.s.weight - x.s.weight);
  yes.sort(order); check.sort(order);
  const watch = WATCH.filter((w) => { try { return w.when(p, c); } catch { return false; } }).concat(extraWatch(p, c));
  const st = evalState(p, a, c);
  return { p, a, c, yes, check, nofit, hidden, watch, st };
}

/* ------------------------------------------------------------- render */
function renderEmptyReport() {
  $('#report').innerHTML = `
    <div class="cover cover--empty">
      <img class="cover__mark" src="${BRAND.mark}" alt="" aria-hidden="true">
      <div class="cover__top"><div class="eyebrow">MSME scheme eligibility report</div></div>
      <h2 class="rname">No business yet</h2>
      <p class="report__empty">Enter a Udyam Registration Number and click Verify. Business details and the scheme report appear only after a number is verified.</p>
    </div>`;
  window.__udyamReport = null;
}
function renderReport() {
  if (state.mode !== 'verified') {
    renderEmptyReport();
    return;
  }
  const R = evaluate();
  const { p, a, c, st } = R;
  const today = fmtD(new Date());
  const place = [p.district, p.state].filter(Boolean).join(', ');
  const missingKeys = ['size', 'activity', 'social', 'state'].filter((k) => !p[k]);
  const lbl = { size: 'category', activity: 'main activity', social: 'social category', state: 'state' };
  const mainNic = (p.nic || [])[0];
  const owner = [SOCIAL_L[p.social] ? `${SOCIAL_L[p.social]} category` : '', a.women === true ? 'woman-owned' : a.women === false ? 'not woman-owned' : 'women ownership not answered'].filter(Boolean).map((t) => `<span class="nw">${esc(t)}</span>`).join(' · ');
  const start = R.yes.slice(0, 3);
  const tY = R.yes.length + st.yes.length, tC = R.check.length + st.check.length, tN = R.nofit.length + st.nofit.length;
  const stN = st.yes.length + st.check.length;

  const card = (x) => {
    const { s, r } = x;
    const apply = s.applyFn ? s.applyFn(p) : s.apply;
    const yes = r.match === 'yes';
    const conf = CONF_L[s.conf];
    return `<article class="scheme" id="s-${s.id}">
      <div class="scheme__meta">
        <span class="status status--${r.match}"><i aria-hidden="true">${yes ? '✓' : '?'}</i>${yes ? 'Strong match' : 'Worth checking'}</span>
        <span class="prog prog--${s.prog.s}">${esc(s.prog.label || PROG[s.prog.s])}</span>
        <span>${esc(s.cat)}</span>
        ${conf ? `<span class="conf conf--${s.conf}">${esc(conf)}</span>` : ''}
        ${x.goalHit ? '<span class="goalhit">Fits your goals</span>' : ''}
      </div>
      <h3 class="scheme__name">${esc(s.name)}${s.abbr && s.abbr !== s.name ? `<span class="abbr">${esc(s.abbr)}</span>` : ''}</h3>
      <p class="scheme__agency">${esc(s.agency)}</p>
      <p class="headline">${esc(r.headline)}</p>
      <ul class="why">${r.why.map((w) => `<li class="${w.ok === true ? 'w-ok' : w.ok === false ? 'w-bad' : 'w-info'}">${esc(w.text)}</li>`).join('')}</ul>
      <details class="more"><summary>Benefits, conditions and how to apply</summary>
        <div class="more__grid">
          <section><h4>What you get</h4><ul>${r.gets.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></section>
          <section><h4>Check before applying</h4><ul>${r.checks.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></section>
          <section><h4>How to apply</h4><ul class="links">${apply.map(([l, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a></li>`).join('')}</ul><h4 style="margin-top:14px">Documents</h4><p>${esc(s.docs)}</p></section>
        </div>
        <p class="more__status"><b>Status:</b> ${esc(s.prog.note)} Source: ${s.src.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join(', ')}. Checked ${esc(s.checked || VERIFIED)}.</p>
      </details>
    </article>`;
  };
  const group = (title, list, desc) => list.length ? `<section class="group"><div class="group__head"><h3>${title}</h3><span class="count">${list.length}</span><p>${desc}</p></div>${list.map(card).join('')}</section>` : '';
  const fold = (title, list, name) => list.length ? `<details class="fold${name ? ' fold--sub' : ''}"><summary><h3>${title}</h3><span class="count">${list.length}</span><span class="toggle"><span class="o">Show why</span><span class="c">Hide</span></span></summary><ul class="nofit">${list.map((x) => `<li><b>${esc(name ? x.s.name : x.s.abbr)}</b><span>${esc(x.r.why[0].text)}</span></li>`).join('')}</ul></details>` : '';

  const stateSection = () => {
    const pin = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><defs><linearGradient id="g-pin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00B2FE"/><stop offset="1" stop-color="#0037D8"/></linearGradient></defs><path d="M12 2.5c-4 0-7 3-7 6.9 0 4.9 5.6 10.8 6.3 11.5a1 1 0 0 0 1.4 0C13.4 20.2 19 14.3 19 9.4c0-3.9-3-6.9-7-6.9z" fill="url(#g-pin)"/><circle cx="12" cy="9.4" r="2.6" fill="#fff"/></svg>';
    if (!st.rec) return `<section class="group" id="state-sec"><div class="group__head"><h3>State schemes</h3><p>Add your state or UT on the left to see its own MSME incentives.</p></div></section>`;
    const { rec, ss } = st;
    const desc = ss.st === 'none' ? `${rec.state} has no MSME incentive policy in force. The central schemes above still apply.`
      : !ss.live ? `What ${rec.state}’s policy offers. Not open to new applications now.`
      : stN ? `Incentives under ${rec.state}’s own policy that fit your details. Where your unit is inside the state can change the rate.`
      : `None of ${rec.state}’s incentives fit the details above.`;
    const refHead = { pending: 'What it offers', draft: 'What the draft proposes', notoperational: 'What it will offer', unverified: 'Items confirmed so far', none: 'Related', lapsed: 'What it offered' }[ss.st] || 'What it offers';
    return `<section class="group stategrp" id="state-sec">
      <div class="group__head"><h3>State schemes · ${esc(rec.state)}</h3>${ss.live ? `<span class="count">${stN}</span>` : ''}<p>${esc(desc)}</p></div>
      <div class="policy">
        <div class="policy__icon">${pin}</div>
        <div class="policy__body">
          <div class="policy__top"><span class="pchip pchip--${ss.st}">${esc(ss.label)}</span>${rec.period ? `<span class="policy__period">${esc(rec.period)}</span>` : ''}</div>
          <p class="policy__name">${esc(rec.short)}</p>
          <p class="policy__status">${esc(rec.statusText)}${ss.note ? ' ' + esc(ss.note) : ''}</p>
          ${rec.zones ? `<p class="policy__zones"><b>Location:</b> ${esc(rec.zones)}</p>` : ''}
          ${rec.notes ? `<p class="policy__notes">${esc(rec.notes)}</p>` : ''}
          <p class="policy__links"><a href="${esc(rec.portal.url)}" target="_blank" rel="noopener">${esc(rec.portal.label)}</a><a href="${esc(rec.source.url)}" target="_blank" rel="noopener">Policy source: ${esc(rec.source.label)}</a></p>
        </div>
      </div>
      ${[...st.yes, ...st.check].map(card).join('')}
      ${fold('Not a fit here', st.nofit, true)}
      ${st.ref.length ? `<div class="reflist"><h4>${esc(refHead)}</h4><ul>${st.ref.map((it) => `<li><b>${esc(it.name)}</b><span>${esc(it.summary)}</span>${CONF_L[it.confidence] ? `<em class="conf conf--${it.confidence}">${esc(CONF_L[it.confidence])}</em>` : ''}</li>`).join('')}</ul></div>` : ''}
    </section>`;
  };
  const hs = hiddenSummary(R.hidden);

  $('#report').innerHTML = `
    <div class="cover">
      <img class="cover__mark" src="${BRAND.mark}" alt="" aria-hidden="true">
      <div class="cover__top">
        <div class="eyebrow">MSME scheme eligibility report · ${esc(today)}</div>
        <div class="dl"><button class="btn btn--light" id="dl" type="button">Download PDF</button><p class="dl__note" id="dl-note"></p></div>
      </div>
      <h2 class="rname">${esc(p.name || 'Your business')}</h2>
      <div class="rmeta">${p.urn ? `<span class="urn">${esc(p.urn)}</span>` : ''}${[SIZE_L[p.size], ACT_L[p.activity], place].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="tally">
        <div><b>${tY}</b><span><i class="dot dot--yes"></i>Strong matches</span></div>
        <div><b>${tC}</b><span><i class="dot dot--check"></i>Worth checking</span></div>
        <div><b>${tN}</b><span><i class="dot dot--no"></i>Not a fit</span></div>
      </div>
      <p class="tally__note">Central, sector${c.goals.has('exports') ? ', export' : ''}${c.goals.has('startup') ? ', startup' : ''} and ${esc(st.rec ? st.rec.state : 'state')} schemes${stN ? `, including ${stN} from the state’s own policy` : ''}.</p>
    </div>
    <div class="rbody">
      ${missingKeys.length ? `<div class="banner banner--missing"><span><b>Missing details.</b> Add the ${esc(missingKeys.map((k) => lbl[k]).join(', '))} on the left for a complete check.</span></div>` : ''}
      <dl class="profile">
        <div><dt>Category</dt><dd>${esc(SIZE_L[p.size] || 'Not set')}${p.sizeYear ? ` (${esc(p.sizeYear)})` : ''}</dd></div>
        <div><dt>Main activity</dt><dd>${esc(ACT_L[p.activity] || 'Not set')}${c.trader && p.activity !== 'trading' ? ' (trading NIC)' : ''}</dd></div>
        <div><dt>Main NIC code</dt><dd>${mainNic ? `<code>${esc(mainNic.code)}</code>${esc(mainNic.desc || '')}` : 'Not set'}</dd></div>
        <div><dt>Location</dt><dd>${esc(place || 'Not set')}</dd></div>
        <div><dt>Owner</dt><dd>${owner}</dd></div>
        <div><dt>Business type</dt><dd>${esc(ORG_L[p.orgType] || 'Not set')}</dd></div>
        <div><dt>In business since</dt><dd>${esc(sinceText(p.commenced) || 'Not set')}</dd></div>
      </dl>
      ${start.length ? `<div class="start"><h3>Where to start</h3><ol>${start.map((x) => `<li><div><a href="#s-${x.s.id}" data-open="${x.s.id}">${esc(x.s.abbr || x.s.name)}</a> <span>${esc(x.r.headline)}</span></div></li>`).join('')}</ol></div>` : ''}
      ${group('Strong matches', R.yes, 'You meet the published criteria on the details above.')}
      ${group('Worth checking', R.check, 'Depends on something your Udyam record does not show, or on the scheme’s current status.')}
      ${stateSection()}
      ${R.watch.length ? `<section class="group"><div class="group__head"><h3>On the horizon</h3><span class="count">${R.watch.length}</span><p>Announced, closed or awaiting notification. Not open to applications now.</p></div><ul class="watch">${R.watch.map((w) => `<li><strong>${esc(w.name)}</strong><span class="prog prog--renewal">${esc(w.status)}</span><p>${esc(w.text)}</p>${w.src ? `<a href="${esc(w.src[1])}" target="_blank" rel="noopener">${esc(w.src[0])}</a>` : ''}</li>`).join('')}</ul></section>` : ''}
      ${fold('Not a fit', R.nofit, false)}
      ${R.hidden.length || state.showAll ? `<div class="hiddenby">${state.showAll ? '<span>Showing every scheme, including ones outside your goals.</span>' : `<span>${c.goals.size ? `Not shown because they are outside your goals${hs.group ? ' or need a group of units' : ''}` : `Shown when you pick the matching goal${hs.group ? ', or for groups of units' : ''}`}: ${esc(hs.parts.join(', '))}.</span>`}<button class="btn btn--ghost btn--sm" type="button" id="toggle-all">${state.showAll ? 'Match my goals only' : 'Show all schemes'}</button></div>` : ''}
      <p class="fine">This report is a guide based on your Udyam record and answers. The bank, state department or implementing agency makes the final decision on eligibility. Central scheme rules were checked against official sources on ${esc(VERIFIED)}; state, sector, export and startup data on ${esc(CHECKED)}. Items marked “Secondary source” or “Not verified” rely on summaries rather than the official text. Several schemes are awaiting renewal, and amounts can change.</p>
    </div>`;

  $('#dl').addEventListener('click', onDownload);
  const t = $('#toggle-all');
  if (t) t.addEventListener('click', () => { state.showAll = !state.showAll; renderReport(); });
  for (const el of document.querySelectorAll('[data-open]')) {
    el.addEventListener('click', () => { const d = document.querySelector(`#s-${el.dataset.open} details`); if (d) d.open = true; });
  }
  window.__udyamReport = R;
}

/* ----------------------------------------------------------- workbench */
function setSrc(k, s) {
  const el = $('#s-' + k);
  if (!el) return;
  const txt = { udyam: 'from Udyam record', cert: 'from certificate', user: 'edited by you', guess: 'best guess, please check', example: 'example', missing: 'needed', ask: 'not on the certificate; please choose' };
  el.dataset.s = s || '';
  el.textContent = s ? txt[s] || '' : '';
}
function syncFields() {
  const p = state.profile;
  for (const k of FIELDS) {
    const el = $('#f-' + k);
    if (!el) continue;
    if (k === 'nic') el.value = (p.nic || []).map((n) => n.code).join(', ');
    else el.value = p[k] || '';
    const need = state.mode === 'verified' && ['size', 'activity', 'social', 'state'].includes(k) && !p[k];
    el.closest('.field').classList.toggle('is-missing', need);
    const has = p[k] && (!Array.isArray(p[k]) || p[k].length);
    setSrc(k, need ? 'missing' : has ? state.src[k] : (k === 'orgType' && state.mode === 'verified') ? 'ask' : '');
  }
  $('#nic-list').innerHTML = (p.nic || []).map((n) => `<li><code>${esc(n.code)}</code> ${esc(n.desc || '')}${n.act ? ` <span class="muted">(${esc(ACT_L[n.act] || n.act)})</span>` : ''}</li>`).join('');
  $('#details-sub').textContent = state.mode === 'verified'
    ? 'From your Udyam record. Correct anything that looks wrong.'
    : 'These details appear after you verify a Udyam Registration Number.';
}
function syncQuestions() {
  const a = state.answers;
  $('#w-yes').setAttribute('aria-pressed', String(a.women === true));
  $('#w-no').setAttribute('aria-pressed', String(a.women === false));
  for (const b of document.querySelectorAll('#goals .chip')) b.setAttribute('aria-pressed', String(a.goals.includes(b.dataset.v)));
  for (const b of document.querySelectorAll('#loans .chip')) b.setAttribute('aria-pressed', String(a.loan === b.dataset.v));
  $('#q-loan').hidden = !(a.goals.includes('credit') || a.goals.includes('machinery'));
}
function refresh() { syncFields(); syncQuestions(); renderReport(); }

function buildControls() {
  const st = $('#f-state');
  for (const [name] of STATES) { const o = document.createElement('option'); o.value = name; o.textContent = name; st.appendChild(o); }
  $('#goals').innerHTML = GOALS.map(([v, l]) => `<button type="button" class="chip" data-v="${v}" aria-pressed="false">${esc(l)}</button>`).join('');
  $('#loans').innerHTML = LOANS.map(([v, l]) => `<button type="button" class="chip" data-v="${v}" aria-pressed="false">${esc(l)}</button>`).join('');
  $('#goals').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const g = state.answers.goals; const i = g.indexOf(b.dataset.v);
    if (i >= 0) g.splice(i, 1); else g.push(b.dataset.v);
    if (!g.includes('credit') && !g.includes('machinery')) state.answers.loan = null;
    syncQuestions(); renderReport();
  });
  $('#loans').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.answers.loan = state.answers.loan === b.dataset.v ? null : b.dataset.v;
    syncQuestions(); renderReport();
  });
  $('#w-yes').addEventListener('click', () => { state.answers.women = state.answers.women === true ? null : true; syncQuestions(); renderReport(); });
  $('#w-no').addEventListener('click', () => { state.answers.women = state.answers.women === false ? null : false; syncQuestions(); renderReport(); });
  for (const k of FIELDS) {
    const el = $('#f-' + k);
    const handler = () => {
      if (k === 'nic') {
        const codes = [...new Set((el.value.match(/\d{5}/g) || []))];
        const prev = state.profile.nic || [];
        state.profile.nic = codes.map((code) => prev.find((n) => n.code === code) || { code, desc: '', act: '' });
      } else if (k === 'state') state.profile.state = el.value;
      else state.profile[k] = el.value.trim();
      state.src[k] = 'user';
      syncFields(); renderReport();
    };
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'change', handler);
  }
}

/* ------------------------------------------------- verified Udyam record */
// src/components/UdyamVerification.tsx calls /api/udyam/verify (the udyamVerify Cloud Function),
// which returns the Cashfree Udyam record using Cashfree's field names. This maps it onto the
// report profile.
function ymdToDmy(s) {
  const t = String(s ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(t);
  return m ? `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}` : '';
}
function activityFrom(s) {
  const t = String(s ?? '').toLowerCase();
  if (/manufactur/.test(t)) return 'manufacturing';
  if (/trad/.test(t)) return 'trading';
  if (/servic/.test(t)) return 'services';
  return '';
}
function socialFrom(s) {
  const t = String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (t === 'GENERAL' || t === 'GEN') return 'general';
  if (t === 'OBC' || t.includes('BACKWARD')) return 'obc';
  if (t === 'SC' || t.includes('SCHEDULEDCASTE')) return 'sc';
  if (t === 'ST' || t.includes('SCHEDULEDTRIBE')) return 'st';
  return '';
}
function sizeFrom(s) {
  const t = String(s ?? '').toLowerCase();
  return ['micro', 'small', 'medium'].find((x) => t.includes(x)) || '';
}
function orgTypeFrom(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  if (/PROPRIET/i.test(t)) return 'proprietorship';
  if (/ONE\s*PERSON/i.test(t)) return 'pvt';
  return orgFromText(t) || 'other';
}
function profileFromUdyam(d) {
  const P = blankProfile();
  const src = {};
  if (!d || typeof d !== 'object') return { profile: P, src };
  const set = (k, v) => { if (v && (!Array.isArray(v) || v.length)) { P[k] = v; src[k] = 'udyam'; } };
  const addr = d.split_address && typeof d.split_address === 'object' ? d.split_address : {};
  const unit = Array.isArray(d.unit_locations) && d.unit_locations[0] && typeof d.unit_locations[0] === 'object' ? d.unit_locations[0] : {};

  const urn = /UDYAM-[A-Z]{2}-\d{2}-\d{7}/.exec(String(d.udyam_number ?? '').toUpperCase());
  set('urn', urn ? urn[0] : '');
  set('name', prettyName(String(d.enterprise_name ?? '').slice(0, 160)));

  // Category: the current classification, or the latest year in the history
  let size = sizeFrom(d.enterprise_type), year = String(d.classification_year ?? '').trim();
  if (!size && Array.isArray(d.classification_history)) {
    const hist = d.classification_history.filter((h) => h && sizeFrom(h.enterprise_type))
      .sort((a, b) => String(b.classification_year ?? '').localeCompare(String(a.classification_year ?? '')));
    if (hist[0]) { size = sizeFrom(hist[0].enterprise_type); year = String(hist[0].classification_year ?? '').trim(); }
  }
  set('size', size);
  if (size && /^\d{4}-\d{2,4}$/.test(year)) P.sizeYear = year;

  set('activity', activityFrom(d.major_activity));
  set('social', socialFrom(d.social_category));

  const st = normState(addr.state) || findStateIn(addr.state) || normState(unit.state) || findStateIn(unit.state);
  if (st) set('state', st);
  else if (P.urn && URN_STATE[P.urn.slice(6, 8)]) { P.state = URN_STATE[P.urn.slice(6, 8)]; src.state = 'guess'; }
  set('district', titleCase(String(addr.district || unit.district || '').trim().slice(0, 60)));
  P.city = titleCase(String(addr.city || unit.city || '').trim().slice(0, 60));
  const pin = String(addr.pincode || unit.pincode || '').trim();
  if (/^\d{6}$/.test(pin)) P.pin = pin;

  P.incorporated = ymdToDmy(d.date_of_incorporation);
  set('commenced', ymdToDmy(d.date_of_commencement) || P.incorporated);
  P.registered = ymdToDmy(d.date_of_udyam_registration);

  const nic = [];
  for (const n of Array.isArray(d.nic_codes) ? d.nic_codes : []) {
    if (!n || typeof n !== 'object') continue;
    const code = (/\d{5}/.exec(String(n.nic_5_digit ?? '')) || [])[0];
    if (code && !nic.some((x) => x.code === code)) nic.push({ code, desc: String(n.nic_5_description ?? '').trim().slice(0, 200), act: activityFrom(n.activity) });
  }
  set('nic', nic);
  if (!P.activity && nic.length && nic.every((n) => n.act === 'trading')) set('activity', 'trading');

  P.dic = String(d.dic ?? '').trim().slice(0, 80);
  P.dfo = String(d.msme_di ?? '').trim().slice(0, 80);
  set('orgType', orgTypeFrom(d.organization_type));
  return { profile: P, src };
}
function applyUdyam(d) {
  const { profile, src } = profileFromUdyam(d);
  const fromSample = state.mode !== 'verified';
  state.mode = 'verified';
  state.profile = profile;
  state.src = src;
  // Goals and credit need belong to the person using the page; ownership belongs to the business.
  state.answers = fromSample ? blankAnswers() : { ...state.answers, women: null };
  if (fromSample) state.showAll = false;
  refresh();
  return profile;
}
function resetToSample() {
  state.mode = 'empty';
  state.profile = blankProfile();
  state.answers = blankAnswers();
  state.src = {};
  state.womenSrc = '';
  state.showAll = false;
  refresh();
}

/* ---------------------------------------------------------- PDF export */
function pdfSafe(s) {
  return String(s ?? '').replace(/₹\s?/g, 'Rs ').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/×/g, 'x').replace(/·/g, '-').replace(/…/g, '...').replace(/−/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}
async function buildPdf() {
  const { jsPDF, GState } = await import('jspdf');
  const IMG = await loadBrandImages();
  const R = evaluate();
  const { p, a } = R;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const PW = 210, PH = 297, M = 16, CW = PW - 2 * M, BOTTOM = PH - 20;
  const C = {
    navy: [0, 36, 90], ink: [13, 33, 71], ink2: [68, 87, 122], ink3: [115, 133, 164], line: [223, 230, 241],
    blue: [0, 55, 216], cyan: [0, 178, 254], link: [11, 69, 219], ok: [10, 132, 88], warn: [169, 100, 0],
    soft: [244, 247, 252], steel: [188, 205, 235], tile: [14, 54, 122], red: [194, 58, 46], white: [255, 255, 255],
  };
  const today = fmtD(new Date());
  const S = R.st;
  const place = [p.district, p.state].filter(Boolean).join(', ');
  let y = M;
  const lh = (size) => size * 0.3528 * 1.38;
  const font = (size, style = 'normal', color = C.ink, face = 'helvetica') => { doc.setFont(face, style); doc.setFontSize(size); doc.setTextColor(...color); };
  const lines = (str, size, width, style = 'normal', face = 'helvetica') => { doc.setFont(face, style); doc.setFontSize(size); return doc.splitTextToSize(pdfSafe(str), width); };
  const ensure = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = M + 6; } };
  const spaced = (t, cs) => doc.getTextWidth(t) + cs * Math.max(0, t.length - 1);
  function para(str, { size = 9.5, style = 'normal', color = C.ink, indent = 0, after = 1.4, face = 'helvetica' } = {}) {
    const h = lh(size);
    for (const ln of lines(str, size, CW - indent, style, face)) { ensure(h); font(size, style, color, face); doc.text(ln, M + indent, y + h * 0.78); y += h; }
    y += after;
  }
  function bullets(list, { size = 9, color = C.ink } = {}) {
    const h = lh(size);
    for (const item of list) {
      lines(item, size, CW - 6).forEach((ln, i) => {
        ensure(h);
        if (i === 0) { doc.setFillColor(...C.blue); doc.circle(M + 1.7, y + h * 0.5, 0.65, 'F'); }
        font(size, 'normal', color); doc.text(ln, M + 6, y + h * 0.78); y += h;
      });
      y += 0.6;
    }
    y += 0.8;
  }
  function markIcon(kind, cx, cy) {
    doc.setFillColor(...(kind === 'ok' ? C.ok : kind === 'bad' ? C.red : C.warn)); doc.circle(cx, cy, 1.45, 'F');
    doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.34);
    if (kind === 'ok') { doc.line(cx - 0.68, cy + 0.02, cx - 0.16, cy + 0.56); doc.line(cx - 0.16, cy + 0.56, cx + 0.72, cy - 0.52); }
    else if (kind === 'bad') { doc.line(cx - 0.55, cy - 0.55, cx + 0.55, cy + 0.55); doc.line(cx + 0.55, cy - 0.55, cx - 0.55, cy + 0.55); }
    else { doc.line(cx, cy - 0.08, cx, cy + 0.7); doc.setFillColor(255, 255, 255); doc.circle(cx, cy - 0.58, 0.18, 'F'); }
  }
  function whyList(list) {
    const size = 8.8, h = lh(size);
    for (const w of list) {
      const kind = w.ok === true ? 'ok' : w.ok === false ? 'bad' : 'info';
      lines(w.text, size, CW - 7).forEach((ln, i) => { ensure(h); if (i === 0) markIcon(kind, M + 1.8, y + h * 0.5); font(size, 'normal', C.ink2); doc.text(ln, M + 5.6, y + h * 0.78); y += h; });
      y += 0.5;
    }
    y += 1.2;
  }
  function label(t) { ensure(10); font(6.8, 'bold', C.ink3); doc.text(pdfSafe(t).toUpperCase(), M, y + 3.2, { charSpace: 0.4 }); y += 5.4; }
  function pill(t, bg, fg, x, yy) { font(6.8, 'bold', fg); const w = doc.getTextWidth(pdfSafe(t)) + 4.6; doc.setFillColor(...bg); doc.roundedRect(x, yy, w, 4.8, 2.4, 2.4, 'F'); doc.text(pdfSafe(t), x + 2.3, yy + 3.35); return w; }
  function gradLine(x0, x1, yy, h = 0.8) { const n = 64; for (let i = 0; i < n; i++) { const t = i / (n - 1); doc.setFillColor(...C.cyan.map((v, k) => Math.round(v + (C.blue[k] - v) * t))); doc.rect(x0 + (x1 - x0) * i / n, yy, (x1 - x0) / n + 0.08, h, 'F'); } }
  function rule(col = C.line, w = 0.3) { doc.setDrawColor(...col); doc.setLineWidth(w); doc.line(M, y, PW - M, y); }
  function linkLine(txt, url) {
    const size = 8.8, h = lh(size), ls = lines(`${txt}: ${url}`, size, CW - 6);
    ensure(h * ls.length);
    const y0 = y;
    font(size, 'normal', C.link); ls.forEach((ln) => { doc.text(ln, M + 6, y + h * 0.78); y += h; });
    doc.link(M + 6, y0, CW - 6, h * ls.length, { url });
    y += 0.5;
  }
  function sectionHead(title, count, desc) {
    ensure(28); y += 4;
    const T = pdfSafe(title).toUpperCase();
    font(8.4, 'bold', C.navy); doc.text(T, M, y + 4, { charSpace: 0.9 });
    const w = spaced(T, 0.9);
    font(8.4, 'normal', C.ink3); doc.text(String(count), M + w + 3, y + 4);
    y += 6.6; gradLine(M, PW - M, y, 0.7); y += 3.4;
    if (desc) para(desc, { size: 8.6, color: C.ink3, after: 1.2 });
  }

  // Cover band
  const coverH = 70;
  doc.setFillColor(...C.navy); doc.rect(0, 0, PW, coverH, 'F');
  try {
    const GS = doc.GState || GState;
    doc.setGState(new GS({ opacity: 0.45 })); doc.setFillColor(10, 58, 147); doc.circle(PW + 6, -18, 78, 'F');
    doc.setGState(new GS({ opacity: 0.1 })); doc.addImage(IMG.mark, 'PNG', PW - 74, -12, 84, 84 * BRAND.markRatio, 'mark', 'FAST');
    doc.setGState(new GS({ opacity: 1 }));
  } catch (e) { /* transparency unsupported: plain band */ }
  gradLine(0, PW, coverH - 1.3, 1.3);
  doc.addImage(IMG.dark, 'PNG', M, 13, 46, 46 * BRAND.ratio, 'logoDark', 'FAST');
  const eb = 'MSME SCHEME ELIGIBILITY REPORT';
  font(6.8, 'bold', C.steel); doc.text(eb, PW - M - spaced(eb, 0.55), 17.5, { charSpace: 0.55 });
  font(8, 'normal', C.steel); doc.text(pdfSafe(`Generated ${today}  |  Rules checked ${checkedText()}`), PW - M, 23, { align: 'right' });
  const fullName = pdfSafe(p.name || 'Your business');
  let ns = 21; font(ns, 'bold', C.white);
  while (ns > 13 && doc.getTextWidth(fullName) > CW) { ns -= 1; font(ns, 'bold', C.white); }
  let nm = fullName;
  if (doc.getTextWidth(nm) > CW) { while (nm.length > 4 && doc.getTextWidth(nm + '...') > CW) nm = nm.slice(0, -1); nm = nm.trim() + '...'; }
  doc.text(nm, M, 42);
  let mx = M;
  if (p.urn) { font(9, 'normal', C.white, 'courier'); doc.text(p.urn, mx, 48.8); mx += doc.getTextWidth(p.urn) + 4; }
  font(9, 'normal', C.steel); doc.text(pdfSafe([SIZE_L[p.size], ACT_L[p.activity], place].filter(Boolean).join('   |   ')), mx, 48.8);
  const tw = (CW - 8) / 3, ty = 54;
  [[R.yes.length + S.yes.length, 'Strong matches', [61, 220, 151]], [R.check.length + S.check.length, 'Worth checking', [245, 192, 78]], [R.nofit.length + S.nofit.length, 'Not a fit', [159, 176, 204]]].forEach(([n, t, col], i) => {
    const x = M + i * (tw + 4);
    doc.setFillColor(...C.tile); doc.roundedRect(x, ty, tw, 11.5, 2, 2, 'F');
    font(14, 'bold', C.white); const nw = doc.getTextWidth(String(n)); doc.text(String(n), x + 4.2, ty + 8.2);
    doc.setFillColor(...col); doc.circle(x + 4.2 + nw + 3.2, ty + 6.25, 0.95, 'F');
    font(8.3, 'normal', C.steel); doc.text(t, x + 4.2 + nw + 5.6, ty + 7.35);
  });
  y = coverH + 8;
  { const stN = S.yes.length + S.check.length; para(`Central, sector${R.c.goals.has('exports') ? ', export' : ''}${R.c.goals.has('startup') ? ', startup' : ''} and ${S.rec ? S.rec.state : 'state'} schemes${stN ? `, including ${stN} from the state's own policy` : ''}.`, { size: 8.4, color: C.ink3, after: 2.4 }); }
  // Business profile
  const mainNic = (p.nic || [])[0];
  const prof = [
    ['Category', `${SIZE_L[p.size] || 'Not set'}${p.sizeYear ? ` (${p.sizeYear})` : ''}`], ['Main activity', ACT_L[p.activity] || 'Not set'],
    ['Location', place || 'Not set'], ['Owner', `${SOCIAL_L[p.social] || '-'} category${a.women === true ? ', woman-owned' : ''}`],
    ['Business type', ORG_L[p.orgType] || 'Not set'], ['In business since', sinceText(p.commenced) || 'Not set'],
    ['Main NIC code', mainNic ? `${mainNic.code} ${mainNic.desc || ''}` : 'Not set'], ['Goals', (a.goals || []).map((g) => (GOALS.find((x) => x[0] === g) || [0, g])[1]).join(', ') || 'Not given'],
  ];
  const colW = CW / 2 - 4;
  for (let i = 0; i < prof.length; i += 2) {
    const pair = [prof[i], prof[i + 1]].filter(Boolean);
    const rowH = Math.max(...pair.map(([, v]) => lines(v, 9.5, colW).length)) * lh(9.5) + 6.4;
    ensure(rowH);
    pair.forEach(([k, v], j) => {
      const x = M + j * (colW + 8);
      font(6.6, 'bold', C.ink3); doc.text(pdfSafe(k).toUpperCase(), x, y + 2.8, { charSpace: 0.35 });
      const ls = lines(v, 9.5, colW); font(9.5, 'normal', C.ink); ls.forEach((ln, kk) => doc.text(ln, x, y + 7.1 + kk * lh(9.5)));
    });
    y += rowH;
  }
  y += 1; rule(); y += 5;

  // Where to start
  if (R.yes.length) {
    const items = R.yes.slice(0, 3);
    const wrapped = items.map((x) => lines(`${x.s.abbr}: ${x.r.headline}`, 9.3, CW - 20));
    const boxH = 11 + wrapped.reduce((s, ls) => s + ls.length * lh(9.3) + 2.4, 0);
    ensure(boxH + 2);
    doc.setFillColor(...C.soft); doc.setDrawColor(...C.line); doc.setLineWidth(0.25); doc.roundedRect(M, y, CW, boxH, 2.6, 2.6, 'FD');
    font(10, 'bold', C.navy); doc.text('Where to start', M + 5.5, y + 7);
    let yy = y + 11.4;
    items.forEach((x, i) => {
      doc.setFillColor(...C.blue); doc.circle(M + 7.6, yy + 1.5, 2.1, 'F');
      font(7.4, 'bold', C.white); doc.text(String(i + 1), M + 7.6, yy + 2.55, { align: 'center' });
      font(9.3, 'normal', C.ink); wrapped[i].forEach((ln, k) => doc.text(ln, M + 12.5, yy + 2.6 + k * lh(9.3)));
      yy += wrapped[i].length * lh(9.3) + 2.4;
    });
    y += boxH + 3;
  }

  // Schemes
  const block = (x) => {
    const { s, r } = x;
    ensure(42); y += 3;
    const yes = r.match === 'yes';
    const w1 = pill(yes ? 'Strong match' : 'Worth checking', yes ? [227, 244, 236] : [255, 242, 220], yes ? C.ok : C.warn, M, y);
    const progCol = s.prog.s === 'deadline' ? C.red : s.prog.s === 'renewal' ? C.warn : s.prog.s === 'new' ? C.link : C.ink3;
    font(6.8, 'bold', progCol); doc.text(pdfSafe(s.prog.label || PROG[s.prog.s]).toUpperCase(), M + w1 + 3, y + 3.35, { charSpace: 0.3 });
    font(7.6, 'normal', C.ink3); doc.text(pdfSafe(s.cat + (CONF_L[s.conf] ? `  |  ${CONF_L[s.conf]}` : '')), PW - M, y + 3.35, { align: 'right' });
    y += 7.6;
    para(s.abbr && s.abbr !== s.name ? `${s.name} (${s.abbr})` : s.name, { size: 11.5, style: 'bold', color: C.navy, after: 0.2 });
    para(s.agency, { size: 8.3, color: C.ink3, after: 1.5 });
    para(r.headline, { size: 10, style: 'bold', color: C.ink, after: 1.8 });
    whyList(r.why);
    label('What you get'); bullets(r.gets);
    label('Check before applying'); bullets(r.checks);
    label('How to apply'); for (const [l, u] of (s.applyFn ? s.applyFn(p) : s.apply)) linkLine(l, u);
    y += 1;
    para('Documents: ' + s.docs, { size: 8.6, color: C.ink2, after: 1 });
    para(`Status: ${s.prog.note} Source: ${s.src.map(([l, u]) => `${l} (${u})`).join('; ')}. Checked ${s.checked || VERIFIED}.`, { size: 7.6, color: C.ink3, after: 2.4 });
    rule(); y += 1;
  };
  function stateBlock() {
    if (!S.rec) { sectionHead('State schemes', '', ''); para('Add the state or UT to see its own MSME incentives.', { size: 9, color: C.ink2, after: 2 }); return; }
    const { rec, ss } = S;
    const stN = S.yes.length + S.check.length;
    sectionHead(`State schemes: ${rec.state}`, ss.live ? stN : '', '');
    // policy box
    const inner = CW - 10;
    const parts = [
      [rec.short, 10.2, 'bold', C.navy],
      [`${ss.label}${rec.period ? '  |  ' + rec.period : ''}`, 8, 'bold', ss.st === 'open' ? C.ok : C.warn],
      [rec.statusText + (ss.note ? ' ' + ss.note : ''), 8.8, 'normal', C.ink2],
      ...(rec.zones ? [[`Location: ${rec.zones}`, 8.6, 'normal', C.ink2]] : []),
      ...(rec.notes ? [[rec.notes, 8.2, 'normal', C.ink3]] : []),
    ];
    const wrapped = parts.map(([t, sz, sty]) => lines(t, sz, inner, sty));
    const linkRows = [[`Apply: ${rec.portal.label}`, rec.portal.url], [`Policy source: ${rec.source.label}`, rec.source.url]].map(([t, u]) => [lines(`${t} (${u})`, 8.4, inner), u]);
    const boxH = 8 + wrapped.reduce((h, ls, i) => h + ls.length * lh(parts[i][1]) + 1.6, 0) + linkRows.reduce((h, [ls]) => h + ls.length * lh(8.4) + 0.8, 0);
    ensure(Math.min(boxH + 4, BOTTOM - M - 10));
    const y0 = y;
    doc.setFillColor(...C.soft); doc.setDrawColor(...C.line); doc.setLineWidth(0.25); doc.roundedRect(M, y0, CW, boxH, 2.6, 2.6, 'FD');
    let yy = y0 + 5;
    wrapped.forEach((ls, i) => { const [, sz, sty, col] = parts[i]; font(sz, sty, col); ls.forEach((ln) => { doc.text(ln, M + 5, yy + lh(sz) * 0.78); yy += lh(sz); }); yy += 1.6; });
    linkRows.forEach(([ls, u]) => { const top = yy; font(8.4, 'normal', C.link); ls.forEach((ln) => { doc.text(ln, M + 5, yy + lh(8.4) * 0.78); yy += lh(8.4); }); doc.link(M + 5, top, inner, yy - top, { url: u }); yy += 0.8; });
    y = y0 + boxH + 4;
    if (ss.live && !stN) para(`None of ${rec.state}'s incentives fit the details above.`, { size: 9, color: C.ink2, after: 2 });
    S.yes.forEach(block); S.check.forEach(block);
    if (S.nofit.length) {
      label(`Not a fit here (${S.nofit.length})`);
      for (const x of S.nofit) { ensure(10); para(x.s.name, { size: 9, style: 'bold', color: C.navy, after: 0.2 }); para(x.r.why[0].text, { size: 8.8, color: C.ink2, after: 1.8 }); }
    }
    if (S.ref.length) {
      label({ pending: 'What it offers', draft: 'What the draft proposes', notoperational: 'What it will offer', unverified: 'Items confirmed so far', none: 'Related', lapsed: 'What it offered' }[ss.st] || 'What it offers');
      for (const it of S.ref) { ensure(10); para(it.name + (CONF_L[it.confidence] ? ` (${CONF_L[it.confidence]})` : ''), { size: 9, style: 'bold', color: C.navy, after: 0.2 }); para(it.summary, { size: 8.8, color: C.ink2, after: 1.8 }); }
    }
  }
  if (R.yes.length) { sectionHead('Strong matches', R.yes.length, 'You meet the published criteria on the details above.'); R.yes.forEach(block); }
  if (R.check.length) { sectionHead('Worth checking', R.check.length, "Depends on something your Udyam record does not show, or on the scheme's current status."); R.check.forEach(block); }
  stateBlock();
  if (R.watch.length) {
    sectionHead('On the horizon', R.watch.length, 'Announced, closed or awaiting notification. Not open to applications now.');
    for (const w of R.watch) {
      ensure(16);
      para(w.name, { size: 9.8, style: 'bold', color: C.navy, after: 0.4 });
      para(w.status, { size: 7.6, style: 'bold', color: C.warn, after: 0.6 });
      para(w.text + (w.src ? ` Source: ${w.src[0]} (${w.src[1]}).` : ''), { size: 8.8, color: C.ink2, after: 2.6 });
    }
  }
  if (R.nofit.length) {
    sectionHead('Not a fit', R.nofit.length, '');
    for (const x of R.nofit) { ensure(10); para(x.s.abbr, { size: 9, style: 'bold', color: C.navy, after: 0.2 }); para(x.r.why[0].text, { size: 8.8, color: C.ink2, after: 1.8 }); }
  }
  if (R.hidden.length) { const hs = hiddenSummary(R.hidden); para(`${R.c.goals.size ? `Left out because they are outside the goals chosen${hs.group ? ' or need a group of units' : ''}` : `Left out until the matching goal is chosen${hs.group ? ', or because they need a group of units' : ''}`}: ${hs.parts.join(', ')}.`, { size: 8.6, color: C.ink3, after: 2 }); }

  y += 4;
  para(`This report is a guide based on the Udyam record and the answers given. The bank, state department or implementing agency makes the final decision on eligibility. Central scheme rules were checked against official sources on ${VERIFIED}; state, sector, export and startup data on ${CHECKED}. Items marked 'Secondary source' or 'Not verified' rely on summaries rather than the official text. Several schemes are awaiting renewal, and amounts can change. An independent PCRED tool, not affiliated with the Ministry of MSME or any government body.`, { size: 7.8, color: C.ink3 });

  // Running header and footer
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    if (i > 1) {
      font(7.2, 'normal', C.ink3); doc.text(pdfSafe(`MSME scheme eligibility report  |  ${p.name || 'Your business'}`), M, 10.5);
      gradLine(M, PW - M, 12.6, 0.45);
    }
    doc.setDrawColor(...C.line); doc.setLineWidth(0.3); doc.line(M, PH - 14.5, PW - M, PH - 14.5);
    doc.addImage(IMG.mark, 'PNG', M, PH - 11.9, 4.6, 4.6 * BRAND.markRatio, 'mark', 'FAST');
    font(7.8, 'bold', C.navy); doc.text('PCRED', M + 6.4, PH - 8.6);
    const bw = doc.getTextWidth('PCRED');
    font(6.2, 'normal', C.ink3); doc.text('TRUST IN US', M + 6.4 + bw + 2.2, PH - 8.6, { charSpace: 0.55 });
    font(7, 'normal', C.ink3); doc.text(pdfSafe(`${p.urn ? p.urn + '  |  ' : ''}Guide only; the bank or agency decides eligibility  |  Page ${i} of ${n}`), PW - M, PH - 8.6, { align: 'right' });
  }
  return doc.output('blob');
}
async function onDownload() {
  const btn = $('#dl'), note = $('#dl-note');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'Preparing PDF…'; note.textContent = '';
  try {
    const blob = await buildPdf();
    const base = (state.profile.urn || state.profile.name || 'MSME').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `PCRED-Scheme-Report-${base || 'MSME'}.pdf`; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    const n = $('#dl-note'); if (n) n.textContent = 'Downloaded.';
  } catch (e) {
    console.error('PDF export failed', e);
    const n = $('#dl-note'); if (n) n.textContent = 'Could not create the PDF. Try again.';
  } finally {
    const b = $('#dl'); if (b) { b.disabled = false; b.textContent = 'Download PDF'; }
  }
}

/* --------------------------------------------------------------- start */
buildControls();
refresh();
const api = { applyUdyam, resetToSample, evaluate, buildPdf, state };
window.__udyam = api;
return api;
}
