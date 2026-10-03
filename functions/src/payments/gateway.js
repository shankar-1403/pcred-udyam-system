const API = 'https://api.cashfree.com/pg';
const API_VERSION = '2023-08-01';

function headers(config) {
    return {
        'Content-Type': 'application/json',
        'x-api-version': API_VERSION,
        'x-client-id': config.clientId,
        'x-client-secret': config.clientSecret,
    };
}

async function readJson(res) {
    const text = await res.text();
    if (!text)
        return {};
    try {
        return JSON.parse(text);
    }
    catch {
        return {};
    }
}

/**
 * Creates a Cashfree Payment Gateway order.
 * Returns `{ ok: true, paymentSessionId }` or `{ ok: false, httpStatus, code, message }`.
 */
export async function createPaymentOrder(config, order, fetchImpl = fetch) {
    let res;
    try {
        res = await fetchImpl(`${API}/orders`, {
            method: 'POST',
            headers: headers(config),
            body: JSON.stringify({
                order_id: order.orderId,
                order_amount: order.amount,
                order_currency: 'INR',
                customer_details: {
                    customer_id: order.customerId,
                    customer_phone: order.phone,
                },
                order_meta: { return_url: order.returnUrl },
                order_tags: { seal: order.sealTag },
                order_note: 'PCRED Udyam scheme report',
            }),
            signal: AbortSignal.timeout(15000),
        });
    }
    catch (e) {
        const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        return { ok: false, httpStatus: timeout ? 504 : 502, code: timeout ? 'TIMEOUT' : 'NETWORK_ERROR', message: 'Cashfree did not respond' };
    }
    const body = await readJson(res);
    if (!res.ok || !body.payment_session_id) {
        return {
            ok: false,
            httpStatus: res.status === 401 || res.status === 403 ? 503 : 502,
            code: typeof body.code === 'string' ? body.code : 'pg_rejected',
            message: typeof body.message === 'string' ? body.message : 'Cashfree rejected the order',
        };
    }
    return { ok: true, paymentSessionId: body.payment_session_id };
}

/** Reads the order and, when it is not marked paid yet, its payment attempts. */
export async function readPaymentOrder(config, orderId, fetchImpl = fetch) {
    let res;
    try {
        res = await fetchImpl(`${API}/orders/${encodeURIComponent(orderId)}`, {
            method: 'GET',
            headers: headers(config),
            signal: AbortSignal.timeout(15000),
        });
    }
    catch (e) {
        const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        return { ok: false, httpStatus: timeout ? 504 : 502, code: timeout ? 'TIMEOUT' : 'NETWORK_ERROR' };
    }
    const order = await readJson(res);
    if (!res.ok)
        return { ok: false, httpStatus: res.status === 404 ? 404 : 502, code: typeof order.code === 'string' ? order.code : 'pg_rejected' };
    let payments = [];
    if (order.order_status !== 'PAID') {
        try {
            const payRes = await fetchImpl(`${API}/orders/${encodeURIComponent(orderId)}/payments`, {
                method: 'GET',
                headers: headers(config),
                signal: AbortSignal.timeout(15000),
            });
            const payBody = await readJson(payRes);
            if (payRes.ok && Array.isArray(payBody))
                payments = payBody;
        }
        catch {
            payments = [];
        }
    }
    const paid = order.order_status === 'PAID' || payments.some((p) => p && p.payment_status === 'SUCCESS');
    return { ok: true, order, paid };
}
