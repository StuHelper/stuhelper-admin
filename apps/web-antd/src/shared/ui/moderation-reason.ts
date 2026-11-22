export const moderationReasonLimit = 2000;

export function isValidModerationReason(reason: string) {
  // The API checks the exact text sent with the decision, including spaces.
  return !!reason.trim() && [...reason].length <= moderationReasonLimit;
}
