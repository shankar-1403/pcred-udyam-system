const FAST2SMS_URL = 'https://www.fast2sms.com/dev/bulkV2';

function detailOf(body) {
    const raw = Array.isArray(body?.message) ? body.message.join(' ') : typeof body?.message === 'string' ? body.message : '';
    return raw.replace(/\d{4,}/g, '####').slice(0, 80);
}

/** Sends the 6-digit code through Fast2SMS. The OTP route delivers "Your OTP: 123456". */
export async function sendFast2Sms({ apiKey, phone, otp, fetchImpl = fetch }) {
    let res;
    try {
        res = await fetchImpl(FAST2SMS_URL, {
            method: 'POST',
            headers: {
                authorization: apiKey,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                route: 'otp',
                variables_values: otp,
                numbers: phone,
                flash: '0',
            }),
            signal: AbortSignal.timeout(10_000),
        });
    }
    catch {
        return { ok: false, reason: 'sms_failed' };
    }
    let body = null;
    try {
        body = await res.json();
    }
    catch {
        body = null;
    }
    if (!res.ok || !body || body.return !== true)
        return { ok: false, reason: 'sms_rejected', detail: detailOf(body) };
    return { ok: true };
}
