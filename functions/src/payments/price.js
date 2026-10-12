/** Udyam-number lookup. The official record is fetched from Cashfree, then the visitor pays. */
export const UDYAM_NUMBER_PRICE_INR = 699;
/** Certificate upload. The PDF is read on the device, then the visitor pays. */
export const CERTIFICATE_PRICE_INR = 499;

export function priceForSource(source) {
    return source === 'certificate' ? CERTIFICATE_PRICE_INR : UDYAM_NUMBER_PRICE_INR;
}

export function isReportPrice(amount) {
    return amount === UDYAM_NUMBER_PRICE_INR || amount === CERTIFICATE_PRICE_INR;
}
