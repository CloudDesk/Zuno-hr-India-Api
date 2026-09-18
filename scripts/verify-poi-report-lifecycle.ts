import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { recomputePOISubmissionState } from '../src/services/tax-declaration.service';
import { POIReportService } from '../src/services/poi-report.service';

const currentProof = (suffix: string) => [{
    documentName: `${suffix}.pdf`,
    documentPath: `test/${suffix}.pdf`,
    uploadDate: new Date('2026-09-18T00:00:00.000Z'),
    isLatestVersion: true,
}];

const declaration: any = {
    _id: new Types.ObjectId(),
    employeeId: new Types.ObjectId(),
    financialYear: '2026-2027',
    regime: 'old',
    poiSubmissionStatus: 'rejected',
    isPOISubmitted: true,
    declarations: [
        {
            section: '80C',
            subSection: 'life_insurance',
            declaredAmount: 50_000,
            verifiedAmount: 50_000,
            status: 'verified',
            documents: currentProof('life-insurance'),
        },
        {
            section: '80D',
            subSection: 'self_family',
            declaredAmount: 25_000,
            verifiedAmount: 0,
            status: 'rejected',
            documents: currentProof('health-insurance-rejected'),
        },
    ],
};

const service = new POIReportService({} as any);

recomputePOISubmissionState(declaration);
assert.equal(declaration.poiSubmissionStatus, 'rejected');
assert.equal(service.evaluateEligibility(declaration).status, 'Rejected');

declaration.declarations[1].status = 'document_submitted';
declaration.declarations[1].documents = currentProof('health-insurance-resubmitted');
recomputePOISubmissionState(declaration);
assert.equal(declaration.poiSubmissionStatus, 'submitted');
assert.equal(service.evaluateEligibility(declaration).status, 'PendingApproval');

const beforeApprovalFingerprint = service.buildFingerprint(declaration);
declaration.declarations[1].status = 'verified';
declaration.declarations[1].verifiedAmount = 25_000;
recomputePOISubmissionState(declaration);
assert.equal(declaration.poiSubmissionStatus, 'verified');
assert.equal(service.evaluateEligibility(declaration).status, 'Eligible');

const approvedFingerprint = service.buildFingerprint(declaration);
assert.notEqual(approvedFingerprint, beforeApprovalFingerprint);
assert.equal(service.buildFingerprint(declaration), approvedFingerprint);

console.log('POI lifecycle verification passed: rejected -> submitted -> verified/eligible with stable source fingerprint.');
