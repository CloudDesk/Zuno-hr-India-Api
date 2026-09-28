export type Form12BWorkflowStatus =
    | 'Released'
    | 'Draft'
    | 'Submitted'
    | 'ResubmissionAllowed'
    | 'Approved'
    | 'FinalRejected';

export function assertForm12BDraftUploadAllowed(
    status: Form12BWorkflowStatus | undefined,
    _reuploadCount: number,
): void {
    if (status && status !== 'Released') {
        throw new Error('Form 12B is locked after upload and cannot be replaced');
    }
}

export function getForm12BDraftAttempt(
    status: Form12BWorkflowStatus | undefined,
    currentAttempt: number,
    reuploadCount: number,
): { submissionAttempt: 1 | 2; reuploadCount: number } {
    if (status === 'ResubmissionAllowed') {
        return { submissionAttempt: 2, reuploadCount: 1 };
    }
    return {
        submissionAttempt: currentAttempt === 2 ? 2 : 1,
        reuploadCount,
    };
}

export function getForm12BReviewOutcome(
    approved: boolean,
    _submissionAttempt: number,
    _reuploadCount: number,
): {
    status: 'Verified' | 'Rejected' | 'ResubmissionRequested';
    workflowStatus: 'Approved' | 'ResubmissionAllowed' | 'FinalRejected';
    isLocked: boolean;
} {
    if (approved) {
        return { status: 'Verified', workflowStatus: 'Approved', isLocked: true };
    }
    return { status: 'Rejected', workflowStatus: 'FinalRejected', isLocked: true };
}

export function assertForm12BReviewAllowed(
    status: Form12BWorkflowStatus | undefined,
    hasStructuredDetails: boolean,
): void {
    const isSignedSubmission = status === 'Submitted';
    const isDetailsSubmission = hasStructuredDetails && (status === 'Released' || status === 'Draft');
    if (!isSignedSubmission && !isDetailsSubmission) {
        throw new Error('Only submitted Form 12B details or a submitted signed Form 12B can be reviewed');
    }
}
