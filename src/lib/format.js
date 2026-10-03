const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2020-05-29" → "29 May 2020"; anything else is returned unchanged. */
export function formatDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (!m)
        return value;
    const month = Number(m[2]) - 1;
    if (month < 0 || month > 11)
        return value;
    return `${Number(m[3])} ${MONTHS[month]} ${m[1]}`;
}
export const hasText = (v) => typeof v === 'string' && v.trim() !== '';
