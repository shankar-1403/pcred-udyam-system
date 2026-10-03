import { useState } from 'react';
import { formatDate, hasText } from '../lib/format';
function Fields({ rows, empty }) {
    const shown = rows.filter(([, v]) => hasText(v));
    if (!shown.length)
        return <p className="ud-empty-note">{empty}</p>;
    return (<dl className="ud-kv">
      {shown.map(([label, value]) => (<div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>))}
    </dl>);
}
function Card({ title, wide, count, children }) {
    return (<section className={`ud-card${wide ? ' ud-card--wide' : ''}`} aria-label={title}>
      <h3 className="ud-card__title">
        {title}
        {typeof count === 'number' ? <span className="ud-card__count">{count}</span> : null}
      </h3>
      {children}
    </section>);
}
const Cell = ({ value }) => hasText(value) ? <>{value}</> : <span className="ud-dash" aria-label="Not provided">—</span>;
function Table({ caption, columns, rows, empty }) {
    if (!rows.length)
        return <p className="ud-empty-note">{empty}</p>;
    return (<div className="ud-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="ud-table">
        <caption className="sr">{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c.label} scope="col" className={c.kind ? `ud-col--${c.kind}` : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (<tr key={i}>
              {columns.map((c) => <td key={c.label} className={c.kind ? `ud-col--${c.kind}` : undefined}><Cell value={c.value(row, i)}/></td>)}
            </tr>))}
        </tbody>
      </table>
    </div>);
}
const serial = (s, i) => (hasText(s) ? s : String(i + 1));
const date = (s) => (hasText(s) ? formatDate(s) : '');
/** Everything Cashfree returned for the verified Udyam Registration Number. */
export default function UdyamDetails({ record }) {
    const [open, setOpen] = useState(true);
    const a = record.split_address;
    return (<section className="ud" id="udyam-details" aria-labelledby="ud-title">
      <header className="ud__head">
        <div className="ud__heading">
          <p className="ud__eyebrow">Udyam Verification</p>
          <h2 className="ud__title" id="ud-title">{record.enterprise_name || record.udyam_number}</h2>
          <p className="ud__meta">
            {hasText(record.udyam_number) ? <span className="ud__urn">{record.udyam_number}</span> : null}
            <span className="ud__badge">Verified</span>
            {hasText(record.enterprise_type) ? <span className="ud__tag">{record.enterprise_type}{hasText(record.classification_year) ? ` · ${record.classification_year}` : ''}</span> : null}
          </p>
        </div>
        <button className="btn btn--ghost btn--sm ud__toggle" type="button" aria-expanded={open} aria-controls="ud-body" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide details' : 'Show details'}
        </button>
      </header>

      <div className="ud__body" id="ud-body" hidden={!open}>
        <div className="ud__grid">
          <Card title="Enterprise Overview">
            <Fields empty="No enterprise details were returned." rows={[
            ['Udyam Registration Number', record.udyam_number],
            ['Enterprise Name', record.enterprise_name],
            ['Organization Type', record.organization_type],
            ['Major Activity', record.major_activity],
            ['Social Category', record.social_category],
            ['Enterprise Type', record.enterprise_type],
        ]}/>
          </Card>

          <Card title="Registration Details">
            <Fields empty="No registration dates were returned." rows={[
            ['Date of Incorporation', date(record.date_of_incorporation)],
            ['Date of Commencement', date(record.date_of_commencement)],
            ['Date of Udyam Registration', date(record.date_of_udyam_registration)],
            ['Classification Year', record.classification_year],
            ['Classification Date', date(record.classification_date)],
        ]}/>
          </Card>

          <Card title="Address">
            <Fields empty="No address was returned." rows={[
            ['Flat', a.flat],
            ['Building', a.building],
            ['Village', a.village],
            ['Block', a.block],
            ['Street', a.street],
            ['City', a.city],
            ['District', a.district],
            ['State', a.state],
            ['Pincode', a.pincode],
            ['Mobile', a.mobile],
            ['Email', a.email],
        ]}/>
          </Card>

          <Card title="Verification">
            <Fields empty="No verification details were returned." rows={[
            ['Verification ID', record.verification_id],
            ['Cashfree Reference ID', record.reference_id],
            ['Verification Status', record.status],
            ['District Industries Centre', record.dic],
            ['MSME Development Institute', record.msme_di],
        ]}/>
          </Card>

          <Card title="Unit Locations" wide count={record.unit_locations.length}>
            <Table caption="Unit locations" empty="No unit locations were returned." rows={record.unit_locations} columns={[
            { label: 'S. No.', value: (r, i) => serial(r.serial_number, i) },
            { label: 'Unit Name', value: (r) => r.unit_name, kind: 'wide' },
            { label: 'Flat', value: (r) => r.flat },
            { label: 'Building', value: (r) => r.building },
            { label: 'Village', value: (r) => r.village },
            { label: 'Block', value: (r) => r.block },
            { label: 'Street', value: (r) => r.street, kind: 'wide' },
            { label: 'City', value: (r) => r.city },
            { label: 'District', value: (r) => r.district },
            { label: 'State', value: (r) => r.state },
            { label: 'Pincode', value: (r) => r.pincode, kind: 'code' },
        ]}/>
          </Card>

          <Card title="NIC Codes" wide count={record.nic_codes.length}>
            <Table caption="NIC codes" empty="No NIC codes were returned." rows={record.nic_codes} columns={[
            { label: 'S. No.', value: (r, i) => serial(r.serial_number, i) },
            { label: 'NIC 2-Digit Code', value: (r) => r.nic_2_digit, kind: 'code' },
            { label: 'NIC 2-Digit Description', value: (r) => r.nic_2_description, kind: 'wide' },
            { label: 'NIC 4-Digit Code', value: (r) => r.nic_4_digit, kind: 'code' },
            { label: 'NIC 4-Digit Description', value: (r) => r.nic_4_description, kind: 'wide' },
            { label: 'NIC 5-Digit Code', value: (r) => r.nic_5_digit, kind: 'code' },
            { label: 'NIC 5-Digit Description', value: (r) => r.nic_5_description, kind: 'wide' },
            { label: 'Activity', value: (r) => r.activity },
            { label: 'Date', value: (r) => date(r.date), kind: 'nowrap' },
        ]}/>
          </Card>

          <Card title="Classification History" wide count={record.classification_history.length}>
            <Table caption="Classification history" empty="No classification history was returned." rows={record.classification_history} columns={[
            { label: 'S. No.', value: (r, i) => serial(r.serial_number, i) },
            { label: 'Classification Year', value: (r) => r.classification_year },
            { label: 'Enterprise Type', value: (r) => r.enterprise_type },
            { label: 'Classification Date', value: (r) => date(r.classification_date), kind: 'nowrap' },
        ]}/>
          </Card>

          <Card title="Udyam Certificate" wide>
            {record.udyam_certificate_url ? (<div className="ud-cert">
                <a className="btn" href={record.udyam_certificate_url} target="_blank" rel="noopener noreferrer" id="udyam-certificate">
                  View Udyam Certificate
                </a>
                <p className="ud-empty-note">Opens the certificate in a new tab, where you can view or download it. The link may expire after some time.</p>
              </div>) : (<p className="ud-empty-note">
                A certificate link was not returned for this registration. You can download the certificate from the{' '}
                <a href="https://udyamregistration.gov.in/" target="_blank" rel="noopener noreferrer">Udyam Registration portal</a>.
              </p>)}
          </Card>
        </div>
      </div>
    </section>);
}
