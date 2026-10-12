/** Which API call this is. Hosting sends `/api/udyam/...`; the emulator may send `/checkout` or `/unlock`. */
export function apiRoute(req) {
    const raw = req?.path || req?.url || req?.originalUrl || '/';
    const path = String(raw).split('?')[0];
    if (path.endsWith('/otp/send'))
        return 'otp-send';
    if (path.endsWith('/otp/verify'))
        return 'otp-verify';
    if (path.endsWith('/certificate'))
        return 'certificate';
    if (path.endsWith('/lead'))
        return 'lead';
    if (path.endsWith('/checkout'))
        return 'checkout';
    if (path.endsWith('/unlock'))
        return 'unlock';
    return 'verify';
}
