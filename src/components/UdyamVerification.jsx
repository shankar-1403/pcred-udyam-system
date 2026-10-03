import { useRef, useState } from 'react';
import { checkUdyamNumber } from '@shared/validate';
const CLIENT_TIMEOUT_MS = 30_000;
const SHOW_REFERENCE = new Set(['SERVICE_UNAVAILABLE', 'UPSTREAM_ERROR', 'BAD_RESPONSE', 'TIMEOUT', 'NETWORK_ERROR', 'INTERNAL_ERROR']);
/** Card 1: enter a Udyam Registration Number and verify it through /api/udyam/verify. */
export default function UdyamVerification({ onVerified, onReset }) {
    const [value, setValue] = useState('');
    const [phase, setPhase] = useState('idle');
    const [fieldError, setFieldError] = useState('');
    const [message, setMessage] = useState('');
    const [reference, setReference] = useState('');
    const inputRef = useRef(null);
    const abortRef = useRef(null);
    const requestSeq = useRef(0);
    const busy = useRef(false);
    async function verify(e) {
        e.preventDefault();
        if (busy.current)
            return; // no duplicate submissions while a request is running
        const check = checkUdyamNumber(value);
        if (!check.ok) {
            setFieldError(check.message);
            setPhase('idle');
            setMessage('');
            inputRef.current?.focus();
            return;
        }
        setValue(check.value);
        setFieldError('');
        setMessage('');
        setReference('');
        setPhase('loading');
        busy.current = true;
        const seq = ++requestSeq.current;
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const timer = setTimeout(() => ctrl.abort('timeout'), CLIENT_TIMEOUT_MS);
        try {
            const res = await fetch('/api/udyam/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ udyam: check.value }),
                signal: ctrl.signal,
                cache: 'no-store',
            });
            let payload = null;
            try {
                payload = (await res.json());
            }
            catch {
                payload = null;
            }
            if (seq !== requestSeq.current)
                return; // reset was pressed meanwhile
            if (payload?.ok && payload.preview && payload.sealed && payload.price) {
                setPhase('success');
                setMessage(`Details fetched: ${payload.preview.enterprise_name || payload.preview.udyam_number}`);
                onVerified({ preview: payload.preview, sealed: payload.sealed, price: payload.price });
            }
            else if (payload && !payload.ok && payload.error?.message) {
                setPhase('error');
                setMessage(payload.error.message);
                setReference(payload.error.reference && SHOW_REFERENCE.has(payload.error.code) ? payload.error.reference : '');
            }
            else {
                setPhase('error');
                setMessage(res.status === 429
                    ? 'Too many verification requests right now. Please wait a minute and try again.'
                    : 'Something went wrong while verifying. Please try again.');
            }
        }
        catch {
            if (seq !== requestSeq.current)
                return;
            setPhase('error');
            setMessage(ctrl.signal.aborted
                ? 'The verification took too long. Please try again.'
                : 'We could not reach the server. Check your internet connection and try again.');
        }
        finally {
            clearTimeout(timer);
            if (seq === requestSeq.current) {
                busy.current = false;
                abortRef.current = null;
            }
        }
    }
    function reset() {
        requestSeq.current += 1;
        abortRef.current?.abort('reset');
        abortRef.current = null;
        busy.current = false;
        setValue('');
        setPhase('idle');
        setFieldError('');
        setMessage('');
        setReference('');
        onReset();
        inputRef.current?.focus();
    }
    const loading = phase === 'loading';
    const describedBy = ['udyam-help', fieldError ? 'udyam-error' : ''].filter(Boolean).join(' ');
    return (<div className="card uv" id="card-udyam">
      <div className="card__head">
        <span className="card__num">1</span>
        <h2>Udyam Verification</h2>
      </div>
      <p className="card__sub">Enter the number on your Udyam certificate. We fetch your record, then you pay to view the full details and download the scheme report.</p>

      <form className="uv__form" onSubmit={verify} noValidate aria-busy={loading}>
        <label className="uv__label" htmlFor="udyam-number">Udyam Registration Number</label>
        <input ref={inputRef} id="udyam-number" name="udyam" className="uv__input" type="text" inputMode="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} placeholder="UDYAM-XX-00-0000000" value={value} onChange={(e) => {
            setValue(e.target.value.toUpperCase());
            if (fieldError)
                setFieldError('');
        }} aria-invalid={fieldError ? true : undefined} aria-describedby={describedBy} disabled={loading}/>
        <p className="uv__help" id="udyam-help">
          Format <span className="uv__code">UDYAM-XX-00-0000000</span>, for example <span className="uv__code">UDYAM-MH-26-0012345</span>.
        </p>
        {fieldError ? <p className="uv__field-error" id="udyam-error" role="alert">{fieldError}</p> : null}

        <div className="uv__actions">
          <button className="btn" type="submit" disabled={loading} id="udyam-verify">
            {loading ? (<><span className="spinner" aria-hidden="true"/>Verifying…</>) : 'Verify'}
          </button>
          <button className="btn btn--ghost" type="button" onClick={reset} id="udyam-reset">Reset</button>
        </div>
      </form>

      <div className="uv__status" role="status" aria-live="polite">
        {loading ? <p className="uv__msg uv__msg--info"><span className="spinner spinner--ink" aria-hidden="true"/>Checking the Udyam record…</p> : null}
        {phase === 'success' ? (<p className="uv__msg uv__msg--ok">
            <span>{message}</span>
            <a href="#udyam-preview">Pay to view the full report</a>
          </p>) : null}
        {phase === 'error' ? (<p className="uv__msg uv__msg--err">
            <span>{message}</span>
            {reference ? <span className="uv__ref">Reference: {reference}</span> : null}
          </p>) : null}
      </div>
      <p className="uv__note">Your number is sent securely to our server, which checks it with Cashfree&apos;s Udyam verification service.</p>
    </div>);
}
