import { parseCertificateLayout, parseCertificateText } from '@shared/parse-certificate';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 3;

function localAsset(path) {
    return new URL(path, window.location.origin).href;
}

function linesFromItems(items) {
    const buckets = [];
    for (const item of items || []) {
        if (!item || typeof item.str !== 'string')
            continue;
        const text = item.str.replace(/\s+/g, ' ').trim();
        if (!text)
            continue;
        const x = item.transform?.[4] ?? 0;
        const y = item.transform?.[5] ?? 0;
        let bucket = buckets.find((row) => Math.abs(row.y - y) < 2.5);
        if (!bucket) {
            bucket = { y, parts: [] };
            buckets.push(bucket);
        }
        bucket.parts.push({ x, text });
    }
    buckets.sort((a, b) => b.y - a.y);
    for (const bucket of buckets)
        bucket.parts.sort((a, b) => a.x - b.x);
    return buckets;
}

async function linesFromPdf(doc, onProgress) {
    const lines = [];
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= pages; i++) {
        onProgress?.(`Reading page ${i} of ${pages}…`);
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        lines.push(...linesFromItems(content.items));
    }
    return lines;
}

function hasDetails(record) {
    const address = record?.split_address || {};
    return Boolean(record?.enterprise_type || record?.major_activity || record?.organization_type || record?.social_category || record?.date_of_incorporation || record?.date_of_commencement || record?.date_of_udyam_registration || address.district || address.state || address.city || address.pincode || record?.nic_codes?.length);
}

/**
 * Reads the certificate PDF in the browser. A government certificate already contains text,
 * so that text is used first. A scanned PDF is read with Tesseract. The file is not uploaded.
 */
export async function readUdyamCertificate(file, onProgress) {
    if (!file)
        throw new Error('Choose the Udyam certificate PDF.');
    const name = String(file.name || '').toLowerCase();
    if ((file.type && file.type !== 'application/pdf') || (!file.type && !name.endsWith('.pdf')))
        throw new Error('Upload the Udyam certificate as a PDF.');
    if (file.size > MAX_BYTES)
        throw new Error('That PDF is larger than 8 MB. Upload the certificate only.');
    onProgress?.('Opening the certificate…');
    const pdfjs = await import('pdfjs-dist');
    const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    const data = new Uint8Array(await file.arrayBuffer());
    let doc;
    try {
        doc = await pdfjs.getDocument({ data }).promise;
    }
    catch {
        throw new Error('This PDF could not be opened. If it is password-protected, upload an unlocked copy.');
    }
    onProgress?.('Reading the certificate…');
    try {
        const laidOut = parseCertificateLayout(await linesFromPdf(doc, onProgress));
        if (laidOut?.udyam_number && laidOut.enterprise_name && laidOut.enterprise_name.length >= 2 && hasDetails(laidOut)) {
            if (typeof doc.destroy === 'function')
                await doc.destroy();
            return laidOut;
        }
    }
    catch {
        /* A scanned certificate has no text layer. OCR below reads the page image. */
    }
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
        workerPath: localAsset('/ocr/worker.min.js'),
        workerBlobURL: false,
        corePath: localAsset('/ocr/tesseract-core-simd-lstm.js'),
        langPath: localAsset('/ocr'),
        logger(m) {
            if (m.status === 'recognizing text' && typeof m.progress === 'number')
                onProgress?.(`Reading the certificate… ${Math.round(m.progress * 100)}%`);
        },
    });
    let text = '';
    try {
        const pages = Math.min(doc.numPages, MAX_PAGES);
        for (let i = 1; i <= pages; i++) {
            onProgress?.(`Reading page ${i} of ${pages}…`);
            const page = await doc.getPage(i);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: context, viewport }).promise;
            const recognized = await worker.recognize(canvas);
            text += `\n${recognized.data.text || ''}`;
        }
    }
    finally {
        await worker.terminate();
        if (typeof doc.destroy === 'function')
            await doc.destroy();
    }
    const record = parseCertificateText(text);
    if (!record)
        throw new Error('Could not find a Udyam Registration Number on this PDF. Upload a clearer certificate, or enter the number instead.');
    return record;
}
