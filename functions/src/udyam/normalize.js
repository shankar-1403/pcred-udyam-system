const MAX_ROWS = 200;
const MAX_TEXT = 500;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function text(v) {
    if (typeof v === 'string') {
        const t = v.trim();
        return t === 'null' || t === 'undefined' ? '' : t.slice(0, MAX_TEXT);
    }
    if (typeof v === 'number' && Number.isFinite(v))
        return String(v);
    return '';
}
function pick(o, keys) {
    const src = isObj(o) ? o : {};
    return Object.fromEntries(keys.map((k) => [k, text(src[k])]));
}
function rows(v, keys) {
    if (!Array.isArray(v))
        return [];
    return v
        .filter(isObj)
        .slice(0, MAX_ROWS)
        .map((r) => pick(r, keys))
        .filter((r) => Object.values(r).some(Boolean));
}
/** Keeps the certificate link only if it is an absolute http(s) URL. */
export function safeHttpUrl(v) {
    const s = text(v);
    if (!s)
        return null;
    try {
        const u = new URL(s);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    }
    catch {
        return null;
    }
}
const ADDRESS_KEYS = ['flat', 'building', 'village', 'block', 'street', 'city', 'district', 'state', 'pincode', 'mobile', 'email'];
const UNIT_KEYS = ['serial_number', 'unit_name', 'flat', 'building', 'village', 'block', 'street', 'city', 'district', 'state', 'pincode'];
const NIC_KEYS = ['serial_number', 'nic_2_digit', 'nic_2_description', 'nic_4_digit', 'nic_4_description', 'nic_5_digit', 'nic_5_description', 'activity', 'date'];
const CLASS_KEYS = ['serial_number', 'classification_year', 'enterprise_type', 'classification_date'];
/**
 * Returns the cleaned record, or null when the body is not a usable SUCCESS response
 * (wrong status, or neither a Udyam number nor an enterprise name).
 */
export function normalizeUdyamSuccess(body, fallbackUdyam = '') {
    if (!isObj(body) || text(body.status) !== 'SUCCESS')
        return null;
    const enterpriseName = text(body.enterprise_name);
    // Cashfree itself must identify the enterprise; the requested number only fills a gap.
    if (!text(body.udyam_number) && !enterpriseName)
        return null;
    const udyamNumber = text(body.udyam_number) || fallbackUdyam;
    const record = {
        verification_id: text(body.verification_id),
        reference_id: text(body.reference_id),
        status: 'SUCCESS',
        udyam_number: udyamNumber,
        enterprise_name: enterpriseName,
        organization_type: text(body.organization_type),
        major_activity: text(body.major_activity),
        social_category: text(body.social_category),
        enterprise_type: text(body.enterprise_type),
        date_of_incorporation: text(body.date_of_incorporation),
        date_of_commencement: text(body.date_of_commencement),
        date_of_udyam_registration: text(body.date_of_udyam_registration),
        classification_year: text(body.classification_year),
        classification_date: text(body.classification_date),
        udyam_certificate_url: safeHttpUrl(body.udyam_certificate_url),
        split_address: pick(body.split_address, ADDRESS_KEYS),
        unit_locations: rows(body.unit_locations, UNIT_KEYS),
        nic_codes: rows(body.nic_codes, NIC_KEYS),
        classification_history: rows(body.classification_history, CLASS_KEYS),
        dic: text(body.dic),
        msme_di: text(body.msme_di),
    };
    return record;
}
