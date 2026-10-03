/**
 * Fields the visitor may see before paying. Enough to confirm the right business was fetched.
 * Address, phone, email, certificate and the scheme report stay inside the seal.
 */
export function publicPreview(record) {
    const address = record?.split_address && typeof record.split_address === 'object' ? record.split_address : {};
    const text = (v) => (typeof v === 'string' ? v : '');
    return {
        enterprise_name: text(record?.enterprise_name),
        udyam_number: text(record?.udyam_number),
        enterprise_type: text(record?.enterprise_type),
        major_activity: text(record?.major_activity),
        organization_type: text(record?.organization_type),
        district: text(address.district) || text(address.city),
        state: text(address.state),
    };
}
