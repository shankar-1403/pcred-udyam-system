// Udyam Registration Number checks shared by the browser form and the API route.
// Format: UDYAM-XX-00-0000000 (2-letter state code, 2-digit district code, 7-digit number).
export const UDYAM_PATTERN = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
export const UDYAM_EXAMPLE = 'UDYAM-MH-26-0012345';
const MAX_INPUT_LENGTH = 40;
/** Trims, upper-cases and tidies separators ("udyam mh 26 0012345" → "UDYAM-MH-26-0012345"). */
export function normalizeUdyamNumber(input) {
    const s = input.trim().toUpperCase().replace(/[‐-―−]/g, '-');
    const m = /^UDYAM[\s-]*([A-Z]{2})[\s-]*(\d{2})[\s-]*(\d{7})$/.exec(s);
    return m ? `UDYAM-${m[1]}-${m[2]}-${m[3]}` : s;
}
export function checkUdyamNumber(input) {
    if (typeof input !== 'string' || !input.trim()) {
        return { ok: false, message: 'Enter your Udyam Registration Number.' };
    }
    if (input.length > MAX_INPUT_LENGTH) {
        return { ok: false, message: 'That is longer than a Udyam Registration Number.' };
    }
    const value = normalizeUdyamNumber(input);
    if (!UDYAM_PATTERN.test(value)) {
        return {
            ok: false,
            message: `Use the format UDYAM-XX-00-0000000, for example ${UDYAM_EXAMPLE}.`,
        };
    }
    return { ok: true, value };
}
/** Keeps state and district codes, hides most of the serial (for logs). */
export function maskUdyamNumber(value) {
    return UDYAM_PATTERN.test(value) ? `${value.slice(0, 12)}****${value.slice(-3)}` : 'invalid';
}
