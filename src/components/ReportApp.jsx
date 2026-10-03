import { memo, useCallback, useEffect, useRef, useState } from 'react';
import UdyamVerification from './UdyamVerification';
import UdyamDetails from './UdyamDetails';
import LockedPreview, { unlockPaidOrder } from './LockedPreview';
import { DETAILS_CARD_HTML, QUESTIONS_CARD_HTML } from './legacy-markup';

const PREVIEW_KEY = 'pcred_udyam_preview';
// The report engine (src/report/engine.js) owns the markup in the memoised blocks below:
// it fills fields, wires buttons and renders the report by element id. React renders those
// blocks once and never re-renders them, so the two never fight over the same DOM.
const Topbar = memo(function Topbar() {
    return (<header className="topbar">
      <div className="brand">
        <img className="logo logo--light" id="logo-l" src="/brand/pcred-logo.png" alt="PCRED, Trust in us" width={149} height={40}/>
        <img className="logo logo--dark" id="logo-d" src="/brand/pcred-logo-dark.png" alt="PCRED, Trust in us" width={149} height={40}/>
        <span className="brand__div" aria-hidden="true"/>
        <div>
          <h1 className="brand__name">Udyam Scheme Report</h1>
          <p className="brand__sub">Government scheme eligibility for MSMEs</p>
        </div>
      </div>
      <span className="verified" dangerouslySetInnerHTML={{ __html: '<i></i>Rules checked' }}/>
    </header>);
});
const LegacyCards = memo(function LegacyCards() {
    return (<>
      <div className="card" id="card-details" dangerouslySetInnerHTML={{ __html: DETAILS_CARD_HTML }}/>
      <div className="card" id="card-questions" dangerouslySetInnerHTML={{ __html: QUESTIONS_CARD_HTML }}/>
    </>);
});
const ReportSection = memo(function ReportSection() {
    return (<section className="report" id="report" aria-live="polite" aria-label="Scheme report" dangerouslySetInnerHTML={{ __html: '<p class="report__loading">Preparing the scheme report…</p>' }}/>);
});
const Footer = memo(function Footer() {
    return (<footer className="foot">
      <div className="foot__brand">
        <img id="foot-mark" src="/brand/pcred-mark.png" alt="" width={22} height={19}/>
        PCRED<span>Trust in us</span>
      </div>
      <p>An independent PCRED tool, not affiliated with the Ministry of MSME or any government body. Check every scheme with the bank or agency before you apply.</p>
    </footer>);
});
function readStoredPreview() {
    try {
        const raw = sessionStorage.getItem(PREVIEW_KEY);
        const pack = raw ? JSON.parse(raw) : null;
        if (pack?.preview && pack?.sealed && pack?.price)
            return pack;
    }
    catch { /* ignore a broken stored preview */ }
    return null;
}
export default function ReportApp() {
    const [record, setRecord] = useState(null);
    const [previewPack, setPreviewPack] = useState(null);
    const [returnError, setReturnError] = useState('');
    const engine = useRef(null);
    const queued = useRef(null);
    const applyRecord = useCallback((r) => {
        if (engine.current)
            engine.current.applyUdyam(r);
        else
            queued.current = { record: r };
    }, []);
    useEffect(() => {
        let active = true;
        import('../report/engine')
            .then(({ initReport }) => {
            if (!active)
                return;
            const api = initReport();
            engine.current = api;
            const q = queued.current;
            queued.current = null;
            if (q) {
                if (q.record)
                    api.applyUdyam(q.record);
                else
                    api.resetToSample();
            }
        })
            .catch((err) => console.error('The scheme report could not be loaded', err));
        return () => {
            active = false;
        };
    }, []);
    useEffect(() => {
        const pack = readStoredPreview();
        if (!pack)
            return;
        const orderId = new URLSearchParams(window.location.search).get('order_id');
        if (!orderId) {
            setPreviewPack(pack);
            return;
        }
        let active = true;
        unlockPaidOrder(orderId, pack.sealed)
            .then((r) => {
            if (!active)
                return;
            sessionStorage.removeItem(PREVIEW_KEY);
            window.history.replaceState({}, '', window.location.pathname);
            setRecord(r);
            applyRecord(r);
        })
            .catch((err) => {
            if (!active)
                return;
            setPreviewPack(pack);
            setReturnError(err instanceof Error ? err.message : 'Payment could not be confirmed.');
        });
        return () => {
            active = false;
        };
    }, [applyRecord]);
    const handleVerified = useCallback((pack) => {
        setRecord(null);
        setReturnError('');
        setPreviewPack(pack);
        try {
            sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(pack));
        }
        catch { /* the preview still works until the page is refreshed */ }
        if (engine.current)
            engine.current.resetToSample();
        else
            queued.current = { record: null };
    }, []);
    const handlePaid = useCallback((r) => {
        sessionStorage.removeItem(PREVIEW_KEY);
        setReturnError('');
        setPreviewPack(null);
        setRecord(r);
        applyRecord(r);
    }, [applyRecord]);
    const handleReset = useCallback(() => {
        sessionStorage.removeItem(PREVIEW_KEY);
        setRecord(null);
        setPreviewPack(null);
        setReturnError('');
        if (engine.current)
            engine.current.resetToSample();
        else
            queued.current = { record: null };
    }, []);
    const locked = Boolean(previewPack) && !record;
    return (<div className="app">
      <Topbar />
      <main className="layout">
        <section className="bench" aria-label="Your details">
          <UdyamVerification onVerified={handleVerified} onReset={handleReset}/>
          <LegacyCards />
        </section>
        <div className="results">
          {record ? <UdyamDetails key={record.verification_id || record.udyam_number} record={record}/> : null}
          {locked ? <LockedPreview pack={previewPack} onPaid={handlePaid}/> : null}
          {locked && returnError ? <p className="uv__msg uv__msg--err" role="alert">{returnError}</p> : null}
          <div hidden={locked || undefined}>
            <ReportSection />
          </div>
        </div>
      </main>
      <Footer />
    </div>);
}
