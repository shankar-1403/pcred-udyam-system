import { describe, expect, it } from 'vitest';
import { extractUdyamNumber, parseCertificateLayout, parseCertificateText } from '../src/udyam/parse-certificate.js';

const SAMPLE = `
UDYAM REGISTRATION CERTIFICATE
UDYAM REGISTRATION NUMBER
UDYAM-MH-26-OO12345
NAME OF ENTERPRISE
SHREE GANESH ENGINEERING WORKS
TYPE OF ENTERPRISE
MICRO
( Micro during previous Financial Year FY 2020-21 )
MAJOR ACTIVITY
MANUFACTURING
SOCIAL CATEGORY OF ENTREPRENEUR
OBC
OFFICIAL ADDRESS OF ENTERPRISE
Flat/Door/Block No. SHED NO. 12
Road/Street/Lane BHOSARI MIDC ROAD
City PUNE
State MAHARASHTRA
District PUNE
Pin 411026
DATE OF INCORPORATION
14/03/2017
DATE OF COMMENCEMENT OF PRODUCTION/BUSINESS
01/04/2017
NATIONAL INDUSTRY CLASSIFICATION CODE(S)
Nic 5 Digit 25920 Machining
Nic 5 Digit 28221 Manufacture of machinery
DATE OF UDYAM REGISTRATION
10/02/2021
TYPE OF ORGANISATION
Proprietary
`;

describe('certificate OCR text', () => {
    it('repairs a misread Udyam number', () => {
        expect(extractUdyamNumber('udyam mh 26 0012345')).toBe('UDYAM-MH-26-0012345');
        expect(extractUdyamNumber('no number here')).toBe('');
    });
    it('reads the printed certificate fields', () => {
        const parsed = parseCertificateText(SAMPLE);
        expect(parsed.udyam_number).toBe('UDYAM-MH-26-0012345');
        expect(parsed.enterprise_name).toBe('SHREE GANESH ENGINEERING WORKS');
        expect(parsed.enterprise_type).toBe('Micro');
        expect(parsed.major_activity).toBe('Manufacturing');
        expect(parsed.social_category).toBe('OBC');
        expect(parsed.organization_type).toBe('Proprietary');
        expect(parsed.date_of_incorporation).toBe('14/03/2017');
        expect(parsed.date_of_commencement).toBe('01/04/2017');
        expect(parsed.date_of_udyam_registration).toBe('10/02/2021');
        expect(parsed.classification_year).toBe('2020-21');
        expect(parsed.split_address).toMatchObject({
            flat: 'SHED NO. 12',
            street: 'BHOSARI MIDC ROAD',
            city: 'PUNE',
            state: 'MAHARASHTRA',
            district: 'PUNE',
            pincode: '411026',
        });
        expect(parsed.nic_codes.map((n) => n.nic_5_digit)).toEqual(['25920', '28221']);
    });
    it('returns null when the number is missing', () => {
        expect(parseCertificateText('NAME OF ENTERPRISE\nACME')).toBeNull();
    });
    it('reads the certificate tables from positioned PDF text', () => {
        const parsed = parseCertificateLayout([
            { parts: [{ x: 40, text: 'UDYAM REGISTRATION NUMBER' }] },
            { parts: [{ x: 40, text: 'UDYAM-MH-18-0245006' }] },
            { parts: [{ x: 40, text: 'NAME OF ENTERPRISE' }] },
            { parts: [{ x: 40, text: 'M/S PCRED VENTURE PRIVATE LIMITED' }] },
            { parts: [{ x: 40, text: 'TYPE OF ENTERPRISE' }] },
            { parts: [{ x: 40, text: 'SNo.' }, { x: 80, text: 'Classification Year' }, { x: 180, text: 'Enterprise Type' }, { x: 300, text: 'Classification Date' }] },
            { parts: [{ x: 40, text: '1' }, { x: 80, text: '2024-25' }, { x: 180, text: 'Micro' }, { x: 300, text: '26/06/2020' }] },
            { parts: [{ x: 40, text: 'MAJOR ACTIVITY' }] },
            { parts: [{ x: 40, text: 'Services' }] },
            { parts: [{ x: 40, text: 'SOCIAL CATEGORY OF ENTREPRENEUR' }] },
            { parts: [{ x: 40, text: 'General' }] },
            { parts: [{ x: 40, text: 'OFFICIAL ADDRESS OF ENTERPRISE' }] },
            { parts: [{ x: 40, text: 'Flat/Door/Block No.' }, { x: 150, text: 'Name of Premises/Building' }, { x: 280, text: 'City' }, { x: 340, text: 'State' }, { x: 430, text: 'District' }, { x: 510, text: 'Pin' }] },
            { parts: [{ x: 40, text: 'OFFICE 4' }, { x: 150, text: 'ABC TOWER' }, { x: 280, text: 'PUNE' }, { x: 340, text: 'MAHARASHTRA' }, { x: 430, text: 'PUNE' }, { x: 510, text: '411001' }] },
            { parts: [{ x: 40, text: 'DATE OF INCORPORATION' }] },
            { parts: [{ x: 40, text: '01/04/2019' }] },
            { parts: [{ x: 40, text: 'DATE OF COMMENCEMENT OF PRODUCTION/BUSINESS' }] },
            { parts: [{ x: 40, text: '01/05/2019' }] },
            { parts: [{ x: 40, text: 'NATIONAL INDUSTRY CLASSIFICATION CODE(S)' }] },
            { parts: [{ x: 40, text: 'SNo.' }, { x: 80, text: 'Nic 2 Digit' }, { x: 220, text: 'Nic 4 Digit' }, { x: 360, text: 'Nic 5 Digit' }, { x: 520, text: 'Activity' }] },
            { parts: [{ x: 40, text: '1' }, { x: 80, text: '62 - Computer programming' }, { x: 220, text: '6201 - Computer programming' }, { x: 360, text: '62013 - Computer programming activities' }, { x: 520, text: 'Services' }] },
            { parts: [{ x: 40, text: 'DATE OF UDYAM REGISTRATION' }] },
            { parts: [{ x: 40, text: '26/06/2020' }] },
            { parts: [{ x: 40, text: 'TYPE OF ORGANISATION' }] },
            { parts: [{ x: 40, text: 'Private Limited Company' }] },
        ]);
        expect(parsed.enterprise_name).toBe('M/S PCRED VENTURE PRIVATE LIMITED');
        expect(parsed.udyam_number).toBe('UDYAM-MH-18-0245006');
        expect(parsed.enterprise_type).toBe('Micro');
        expect(parsed.major_activity).toBe('Services');
        expect(parsed.social_category).toBe('GENERAL');
        expect(parsed.organization_type).toBe('Private Limited Company');
        expect(parsed.classification_year).toBe('2024-25');
        expect(parsed.date_of_incorporation).toBe('01/04/2019');
        expect(parsed.date_of_commencement).toBe('01/05/2019');
        expect(parsed.date_of_udyam_registration).toBe('26/06/2020');
        expect(parsed.split_address).toMatchObject({
            flat: 'OFFICE 4',
            building: 'ABC TOWER',
            city: 'PUNE',
            state: 'MAHARASHTRA',
            district: 'PUNE',
            pincode: '411001',
        });
        expect(parsed.nic_codes[0]).toMatchObject({
            nic_5_digit: '62013',
            nic_5_description: 'Computer programming activities',
        });
    });
});
