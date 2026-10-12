import { checkUdyamNumber } from '../udyam/validate.js';

const TEXT = 200;

function clip(v) {
    if (typeof v !== 'string')
        return '';
    return v.replace(/\s+/g, ' ').trim().slice(0, TEXT);
}

/**
 * Builds a Cashfree-shaped SUCCESS body from fields read off a certificate.
 * Only known fields are kept.
 */
export function certificateBody(input) {
    if (!input || typeof input !== 'object')
        return { ok: false, message: 'The certificate details are missing.' };
    const check = checkUdyamNumber(typeof input.udyam_number === 'string' ? input.udyam_number : '');
    if (!check.ok)
        return { ok: false, message: 'The certificate did not include a valid Udyam Registration Number.' };
    const name = clip(input.enterprise_name);
    if (name.length < 2)
        return { ok: false, message: 'The certificate did not include a business name. Upload a clearer PDF.' };
    const addr = input.split_address && typeof input.split_address === 'object' ? input.split_address : {};
    const nic = Array.isArray(input.nic_codes) ? input.nic_codes.slice(0, 30) : [];
    return {
        ok: true,
        body: {
            status: 'SUCCESS',
            verification_id: '',
            reference_id: '',
            udyam_number: check.value,
            enterprise_name: name,
            organization_type: clip(input.organization_type),
            major_activity: clip(input.major_activity),
            social_category: clip(input.social_category),
            enterprise_type: clip(input.enterprise_type),
            date_of_incorporation: clip(input.date_of_incorporation),
            date_of_commencement: clip(input.date_of_commencement),
            date_of_udyam_registration: clip(input.date_of_udyam_registration),
            classification_year: clip(input.classification_year),
            classification_date: '',
            udyam_certificate_url: null,
            split_address: {
                flat: clip(addr.flat),
                building: clip(addr.building),
                village: '',
                block: '',
                street: clip(addr.street),
                city: clip(addr.city),
                district: clip(addr.district),
                state: clip(addr.state),
                pincode: clip(addr.pincode).replace(/\D/g, '').slice(0, 6),
                mobile: '',
                email: '',
            },
            unit_locations: [],
            nic_codes: nic.map((n, i) => ({
                serial_number: String(i + 1),
                nic_2_digit: '',
                nic_2_description: '',
                nic_4_digit: '',
                nic_4_description: '',
                nic_5_digit: clip(n && typeof n === 'object' ? n.nic_5_digit : '').replace(/\D/g, '').slice(0, 5),
                nic_5_description: clip(n && typeof n === 'object' ? n.nic_5_description : ''),
                activity: clip(n && typeof n === 'object' ? n.activity : ''),
                date: '',
            })).filter((n) => n.nic_5_digit.length === 5),
            classification_history: [],
            dic: '',
            msme_di: '',
        },
    };
}
