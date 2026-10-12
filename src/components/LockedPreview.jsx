import { useState } from 'react';

const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

function loadCashfree() {
    if (typeof window.Cashfree === 'function')
        return Promise.resolve(window.Cashfree);
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${SDK_URL}"]`);
        const finish = () => (typeof window.Cashfree === 'function' ? resolve(window.Cashfree) : reject(new Error('sdk')));
        if (existing) {
            existing.addEventListener('load', finish, { once: true });
            existing.addEventListener('error', () => reject(new Error('sdk')), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = SDK_URL;
        script.async = true;
        script.onload = finish;
        script.onerror = () => reject(new Error('sdk'));
        document.head.appendChild(script);
    });
}

async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
    });
    let payload = null;
    try {
        payload = await res.json();
    }
    catch {
        payload = null;
    }
    return { res, payload };
}

function rupees(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n))
        return '';
    return `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/**
 * Right-hand confirmation: the fetched business is readable, the rest of the report is blurred
 * until Cashfree confirms payment. The full record never arrives in the browser before that.
 */
export default function LockedPreview({ pack, onPaid }) {
    const preview = pack.preview;
    const priceLabel = rupees(pack.price?.amount);
    const fromCertificate = pack.source === 'cert';
    const [phone, setPhone] = useState(() => (typeof pack.phone === 'string' ? pack.phone.replace(/\D/g, '').slice(0, 10) : ''));
    const [phase, setPhase] = useState('idle');
    const [message, setMessage] = useState('');
    const rows = [
        ['Enterprise type', preview.enterprise_type],
        ['Activity', preview.major_activity],
        ['Organisation', preview.organization_type],
        ['District', preview.district],
        ['State', preview.state],
    ].filter(([, value]) => typeof value === 'string' && value.trim());

    async function pay(e) {
        e.preventDefault();
        if (phase === 'paying')
            return;
        const mobile = phone.replace(/\s+/g, '');
        if (!/^[6-9]\d{9}$/.test(mobile)) {
            setPhase('error');
            setMessage('Enter a 10-digit Indian mobile number. Cashfree uses it for the payment.');
            return;
        }
        setPhase('paying');
        setMessage('');
        try {
            const started = await postJson('/api/udyam/checkout', { sealed: pack.sealed, phone: mobile });
            if (!started.payload?.ok || !started.payload.payment_session_id || !started.payload.order_id) {
                setPhase('error');
                setMessage(started.payload?.error?.message || 'Payment could not be started. Please try again.');
                return;
            }
            const Cashfree = await loadCashfree();
            const cashfree = Cashfree({ mode: 'production' });
            const result = await cashfree.checkout({
                paymentSessionId: started.payload.payment_session_id,
                redirectTarget: '_modal',
            });
            if (result?.error) {
                setPhase('error');
                setMessage(result.error.message || 'Payment was not completed.');
                return;
            }
            if (result?.redirect)
                return;
            const opened = await postJson('/api/udyam/unlock', { order_id: started.payload.order_id, sealed: pack.sealed });
            if (opened.payload?.ok && opened.payload.data) {
                setPhase('idle');
                onPaid(opened.payload.data);
                return;
            }
            setPhase('error');
            setMessage(opened.payload?.error?.message || 'Payment could not be confirmed. Please try again.');
        }
        catch {
            setPhase('error');
            setMessage('Payment could not be opened. Check your connection and try again.');
        }
    }

    const paying = phase === 'paying';
    return (<section className="ud ud-lock" id="udyam-preview" aria-labelledby="udyam-preview-title">
      <header className="ud__head">
        <div className="ud__heading">
          <p className="ud__eyebrow">{fromCertificate ? 'Read from your certificate' : 'Udyam record fetched'}</p>
          <h2 className="ud__title" id="udyam-preview-title">{preview.enterprise_name || preview.udyam_number}</h2>
          <p className="ud__meta">
            {preview.udyam_number ? <span className="ud__urn">{preview.udyam_number}</span> : null}
            <span className="ud__tag">Awaiting payment</span>
          </p>
        </div>
      </header>
      <p className="ud-lock__lead">{fromCertificate
            ? `This is what we read from your certificate. Pay ${priceLabel} to open the scheme report.`
            : `This is your fetched record. Pay ${priceLabel} to open the full details and download the scheme report.`}</p>
      <div className="ud-lock__sheet">
        <dl className="ud-lock__clear">
          {rows.map(([label, value]) => (<div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>))}
        </dl>
        <div className="ud-lock__blur" aria-hidden="true">
          <p>Registered address</p>
          <span className="ud-lock__bar"/>
          <span className="ud-lock__bar ud-lock__bar--short"/>
          <p>Scheme eligibility</p>
          <span className="ud-lock__bar"/>
          <span className="ud-lock__bar ud-lock__bar--mid"/>
          <p>Credit guarantee and subsidy</p>
          <span className="ud-lock__bar"/>
          <p>Where to start</p>
          <span className="ud-lock__bar ud-lock__bar--short"/>
        </div>
      </div>
      <form className="ud-lock__pay" onSubmit={pay} noValidate>
        <label className="uv__label" htmlFor="pay-phone">Mobile number</label>
        <input id="pay-phone" name="phone" className="uv__input" type="tel" inputMode="numeric" autoComplete="tel" maxLength={10} placeholder="10-digit mobile number" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} disabled={paying}/>
        <button className="btn" type="submit" id="pay-preview" disabled={paying}>
          {paying ? (<><span className="spinner" aria-hidden="true"/>Opening payment…</>) : `Pay ${priceLabel} to view and download`}
        </button>
        {message ? <p className="uv__msg uv__msg--err" role="alert">{message}</p> : null}
        <p className="ud-lock__note">{fromCertificate
            ? 'Payment opens in Cashfree. The scheme report stays hidden until the payment succeeds.'
            : 'Payment opens in Cashfree. The full record and the PDF stay hidden until the payment succeeds.'}</p>
      </form>
    </section>);
}

/** Called after Cashfree redirects back to this site with ?order_id=. */
export async function unlockPaidOrder(orderId, sealed) {
    const opened = await postJson('/api/udyam/unlock', { order_id: orderId, sealed });
    if (opened.payload?.ok && opened.payload.data)
        return opened.payload.data;
    const error = new Error(opened.payload?.error?.message || 'Payment could not be confirmed.');
    error.code = opened.payload?.error?.code || 'UNLOCK_FAILED';
    throw error;
}
