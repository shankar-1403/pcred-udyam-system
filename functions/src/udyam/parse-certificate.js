import { UDYAM_PATTERN } from './validate.js';

function section(text, start, end) {
    const m = new RegExp(start, 'i').exec(text);
    if (!m)
        return '';
    const rest = text.slice(m.index + m[0].length);
    const stop = new RegExp(end, 'i').exec(rest);
    return (stop ? rest.slice(0, stop.index) : rest.slice(0, 600)).trim();
}

function firstLine(block) {
    const lines = block.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s && !/^(UDYAM|NAME OF|TYPE OF|MAJOR |SOCIAL |SNO\.?\b|S\.?\s*NO\b|CLASSIFICATION )/i.test(s));
    return lines.slice(0, 3).join(' ').slice(0, 160);
}

function labeled(block, label) {
    const m = new RegExp(`${label}\\s*[:.-]?\\s*([^\\n]*)`, 'i').exec(block);
    if (!m)
        return '';
    let value = m[1].trim();
    if (!value) {
        const rest = block.slice(m.index + m[0].length);
        value = rest.split('\n').map((s) => s.trim()).find(Boolean) || '';
    }
    return value.replace(/\s+/g, ' ').slice(0, 80);
}

function word(block, pattern) {
    const m = pattern.exec(block);
    if (!m)
        return '';
    const w = m[1].toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
}

function dateAfter(text, label) {
    const block = section(text, label, 'DATE OF|NATIONAL INDUSTRY|TYPE OF ORGAN|DIC |NAME OF UNIT|OFFICIAL ADDRESS');
    const m = /(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{4})/.exec(block);
    return m ? `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}` : '';
}

/** Pulls a Udyam number out of OCR text, including a few common misreads (O for 0). */
export function extractUdyamNumber(text) {
    const spaced = String(text || '').toUpperCase().replace(/[‐-―−]/g, '-').replace(/[ \t]+/g, ' ');
    const m = /UDYAM[\s-]*([A-Z0-9]{2})[\s-]*([0-9OIL]{2})[\s-]*([0-9OIL]{7})/.exec(spaced);
    if (!m)
        return '';
    const state = m[1].replace(/0/g, 'O').replace(/1/g, 'I');
    const dist = m[2].replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1');
    const serial = m[3].replace(/O/g, '0').replace(/I/g, '1').replace(/L/g, '1');
    const value = `UDYAM-${state}-${dist}-${serial}`;
    return UDYAM_PATTERN.test(value) ? value : '';
}

function nicCodes(text) {
    const block = section(text, 'NATIONAL INDUSTRY CLASSIFICATION', 'DATE OF UDYAM|TYPE OF ORGAN|DIC |DECLARATION');
    const out = [];
    const re = /NIC\s*5\s*Digit\s*(\d{5})\s*([^\n]*)/gi;
    let m;
    while ((m = re.exec(block))) {
        if (out.some((x) => x.nic_5_digit === m[1]))
            continue;
        out.push({
            nic_5_digit: m[1],
            nic_5_description: m[2].replace(/\s+/g, ' ').trim().slice(0, 160),
            activity: '',
        });
    }
    return out.slice(0, 20);
}

/**
 * Reads the fields a Udyam Registration Certificate usually prints.
 * Returns null when no Udyam number is present.
 */
export function parseCertificateText(text) {
    const source = String(text || '').replace(/\r/g, '\n');
    const udyam = extractUdyamNumber(source);
    if (!udyam)
        return null;
    const addressBlock = section(source, 'OFFICIAL ADDRESS OF ENTERPRISE', 'DATE OF INCORPORATION|DATE OF COMMENCEMENT|DATE OF UDYAM|NATIONAL INDUSTRY');
    const pin = labeled(addressBlock, 'Pin(?:code)?').replace(/\D/g, '').slice(0, 6);
    const orgBlock = section(source, 'TYPE OF ORGANIS(?:ATION|ZATION)', 'DATE OF|NATIONAL INDUSTRY|DIC |OFFICIAL ADDRESS|NAME OF');
    const orgLine = firstLine(orgBlock);
    const orgFallback = /\b(Proprietary|Partnership|Private Limited Company|Limited Liability Partnership|Hindu Undivided Family|Public Limited Company|Co-operative Society|Society|Trust)\b/i.exec(source);
    const fy = /FY\s*(\d{4}\s*[-–]\s*\d{2,4})/i.exec(source);
    return {
        udyam_number: udyam,
        enterprise_name: firstLine(section(source, 'NAME OF ENTERPRISE', 'TYPE OF ENTERPRISE|MAJOR ACTIVITY|SOCIAL CATEGORY|NAME OF UNIT')),
        enterprise_type: word(section(source, 'TYPE OF ENTERPRISE', 'MAJOR ACTIVITY|SOCIAL CATEGORY|NAME OF UNIT|OFFICIAL ADDRESS'), /\b(MICRO|SMALL|MEDIUM)\b/i),
        major_activity: word(section(source, 'MAJOR ACTIVITY', 'SOCIAL CATEGORY|NAME OF UNIT|OFFICIAL ADDRESS|TYPE OF'), /\b(MANUFACTURING|SERVICES|TRADING)\b/i),
        social_category: (/\b(GENERAL|OBC|SC|ST|SCHEDULED CASTE|SCHEDULED TRIBE)\b/i.exec(section(source, 'SOCIAL CATEGORY', 'NAME OF UNIT|OFFICIAL ADDRESS|MAJOR ACTIVITY|TYPE OF')) || [])[1]?.toUpperCase() || '',
        organization_type: orgLine || (orgFallback ? orgFallback[1] : ''),
        date_of_incorporation: dateAfter(source, 'DATE OF INCORPORATION'),
        date_of_commencement: dateAfter(source, 'DATE OF COMMENCEMENT'),
        date_of_udyam_registration: dateAfter(source, 'DATE OF UDYAM REGISTRATION'),
        classification_year: fy ? fy[1].replace(/\s+/g, '') : '',
        split_address: {
            flat: labeled(addressBlock, 'Flat\\s*/\\s*Door\\s*/\\s*Block\\s*No\\.?'),
            building: labeled(addressBlock, 'Name of Premises\\s*/\\s*Building'),
            street: labeled(addressBlock, 'Road\\s*/\\s*Street\\s*/\\s*Lane'),
            city: labeled(addressBlock, 'City'),
            district: labeled(addressBlock, 'District'),
            state: labeled(addressBlock, 'State'),
            pincode: pin.length === 6 ? pin : '',
        },
        nic_codes: nicCodes(source),
    };
}

function lineText(line) {
    return (line?.parts || []).map((part) => part.text).join(' ');
}

function titleWord(value) {
    const m = /\b(MICRO|SMALL|MEDIUM|MANUFACTURING|SERVICES|TRADING)\b/i.exec(value || '');
    if (!m)
        return '';
    const w = m[1].toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Puts each value under the header whose left edge is closest on its left. */
function assignColumns(headers, values) {
    const cells = [...headers].sort((a, b) => a.x - b.x).map((header) => ({ ...header, value: '' }));
    for (const value of [...values].sort((a, b) => a.x - b.x)) {
        let index = 0;
        for (let i = 0; i < cells.length; i++) {
            if (value.x + 6 >= cells[i].x)
                index = i;
        }
        if (!cells.length)
            continue;
        cells[index].value = cells[index].value ? `${cells[index].value} ${value.text}` : value.text;
    }
    return cells;
}

function columnValue(lines, headerTest) {
    for (let i = 0; i < lines.length - 1; i++) {
        if (!lines[i].parts.some((part) => headerTest.test(part.text)))
            continue;
        const next = lines.slice(i + 1).find((line) => line.parts?.length);
        if (!next)
            return '';
        const cell = assignColumns(lines[i].parts, next.parts).find((item) => headerTest.test(item.text));
        if (cell?.value)
            return cell.value.replace(/\s+/g, ' ').trim();
    }
    return '';
}

function headerKey(text) {
    const t = text.toLowerCase();
    if (/flat\s*\/\s*door/.test(t))
        return 'flat';
    if (/premises|building/.test(t))
        return 'building';
    if (/road\s*\/\s*street|\blane\b/.test(t))
        return 'street';
    if (/^city\b/.test(t))
        return 'city';
    if (/^state\b/.test(t))
        return 'state';
    if (/^district\b/.test(t))
        return 'district';
    if (/^pin/.test(t))
        return 'pincode';
    return '';
}

function addressTable(lines) {
    const index = lines.findIndex((line) => {
        const text = lineText(line);
        return /flat\s*\/\s*door/i.test(text) && /district/i.test(text) && /\bpin/i.test(text);
    });
    if (index < 0)
        return null;
    const next = lines.slice(index + 1).find((line) => line.parts?.length && !/date of|national industry/i.test(lineText(line)));
    if (!next)
        return null;
    const address = {};
    for (const cell of assignColumns(lines[index].parts, next.parts)) {
        const key = headerKey(cell.text);
        if (!key || !cell.value)
            continue;
        address[key] = key === 'pincode' ? cell.value.replace(/\D/g, '').slice(0, 6) : cell.value.replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    return address;
}

function nicTable(lines) {
    const start = lines.findIndex((line) => line.parts.some((part) => /nic\s*5\s*digit/i.test(part.text)));
    if (start < 0)
        return [];
    const out = [];
    for (const line of lines.slice(start + 1, start + 30)) {
        const joined = lineText(line);
        if (/date of udyam|type of organ|declaration/i.test(joined))
            break;
        const cell = assignColumns(lines[start].parts, line.parts).find((item) => /nic\s*5\s*digit/i.test(item.text));
        const match = /(\d{5})\s*[-–:]?\s*(.*)/.exec(cell?.value || '');
        if (!match || out.some((item) => item.nic_5_digit === match[1]))
            continue;
        out.push({
            nic_5_digit: match[1],
            nic_5_description: match[2].replace(/\s+/g, ' ').trim().slice(0, 160),
            activity: '',
        });
    }
    return out.slice(0, 20);
}

/**
 * Same fields as {@link parseCertificateText}, using the PDF's positioned text
 * so table columns (enterprise type, address, NIC) stay attached to their headers.
 */
export function parseCertificateLayout(lines) {
    if (!Array.isArray(lines) || !lines.length)
        return null;
    const parsed = parseCertificateText(lines.map(lineText).join('\n'));
    if (!parsed)
        return null;
    const type = titleWord(columnValue(lines, /enterprise\s*type/i));
    if (type)
        parsed.enterprise_type = type;
    const year = columnValue(lines, /classification\s*year/i).replace(/\s+/g, '');
    if (year && !parsed.classification_year)
        parsed.classification_year = year.slice(0, 20);
    const address = addressTable(lines);
    if (address)
        parsed.split_address = { ...parsed.split_address, ...address };
    const nic = nicTable(lines);
    if (nic.length)
        parsed.nic_codes = nic;
    return parsed;
}
