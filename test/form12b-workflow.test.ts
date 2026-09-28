import { applyForm12BTDS } from '../src/utilis/form12b-tax';
import {
    assertForm12BDraftUploadAllowed,
    assertForm12BReviewAllowed,
    getForm12BReviewOutcome,
} from '../src/utilis/form12b-workflow';
import {
    assertForm12BJoiningDateEligible,
    getForm12BJoiningDateQuery,
} from '../src/utilis/form12b-eligibility';

describe('Form 12B workflow', () => {
    it('allows the first upload after Form 12B is enabled', () => {
        expect(() => assertForm12BDraftUploadAllowed('Released', 0)).not.toThrow();
    });

    it('locks replacement after employee submission or final processing', () => {
        expect(() => assertForm12BDraftUploadAllowed('Submitted', 0)).toThrow(/locked/);
        expect(() => assertForm12BDraftUploadAllowed('Approved', 0)).toThrow(/locked/);
        expect(() => assertForm12BDraftUploadAllowed('FinalRejected', 1)).toThrow(/locked/);
    });

    it('does not permit another upload after rejection', () => {
        expect(getForm12BReviewOutcome(false, 1, 0)).toEqual({
            status: 'Rejected',
            workflowStatus: 'FinalRejected',
            isLocked: true,
        });
        expect(() => assertForm12BDraftUploadAllowed('FinalRejected', 0)).toThrow(/cannot be replaced/);
    });

    it('makes rejection of the second submission final', () => {
        expect(getForm12BReviewOutcome(false, 2, 1)).toEqual({
            status: 'Rejected',
            workflowStatus: 'FinalRejected',
            isLocked: true,
        });
    });

    it('permanently locks an approved submission', () => {
        expect(getForm12BReviewOutcome(true, 1, 0)).toEqual({
            status: 'Verified',
            workflowStatus: 'Approved',
            isLocked: true,
        });
    });

    it('allows admin review after the employee saves structured details', () => {
        expect(() => assertForm12BReviewAllowed('Released', true)).not.toThrow();
        expect(() => assertForm12BReviewAllowed('Draft', true)).not.toThrow();
    });

    it('keeps an unsigned blank release unavailable for review', () => {
        expect(() => assertForm12BReviewAllowed('Released', false)).toThrow(/submitted Form 12B details/);
    });

    it('allows admin review after the signed form is submitted', () => {
        expect(() => assertForm12BReviewAllowed('Submitted', false)).not.toThrow();
    });
});

describe('existing Form 12B tax credit behavior', () => {
    it('subtracts verified previous-employer TDS without changing the formula', () => {
        expect(applyForm12BTDS(40_500, 10_000)).toBe(30_500);
    });

    it('never produces negative final tax', () => {
        expect(applyForm12BTDS(8_000, 10_000)).toBe(0);
    });
});

describe('Form 12B employee eligibility', () => {
    it('includes employees joining within the selected financial year', () => {
        expect(() => assertForm12BJoiningDateEligible('2026-04-01', '2026-2027')).not.toThrow();
        expect(() => assertForm12BJoiningDateEligible('2027-03-31', '2026-2027')).not.toThrow();
    });

    it('excludes employees who joined before or after the selected financial year', () => {
        expect(() => assertForm12BJoiningDateEligible('2026-03-31', '2026-2027')).toThrow(/not eligible/);
        expect(() => assertForm12BJoiningDateEligible('2027-04-01', '2026-2027')).toThrow(/not eligible/);
    });

    it('builds an inclusive-start and exclusive-end database range', () => {
        expect(getForm12BJoiningDateQuery('2026-2027')).toEqual({
            $gte: new Date('2026-04-01T00:00:00.000Z'),
            $lt: new Date('2027-04-01T00:00:00.000Z'),
        });
    });
});
