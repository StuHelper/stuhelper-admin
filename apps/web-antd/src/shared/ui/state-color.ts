/**
 * Tag colors for workflow states shared by the admin lists, so the same state
 * reads the same everywhere: work waiting for an administrator is orange, work in
 * progress is blue, finished outcomes are green, failures and refusals are red,
 * and closed or inactive records stay neutral. Unknown states stay neutral.
 */
const tones: Record<string, string> = {
  // Waiting for an administrator or the user.
  pending: 'orange', pending_review: 'orange', waiting: 'orange', submitted: 'orange', manual: 'orange',
  needs_review: 'orange', supplement_required: 'orange', changes_requested: 'orange', review_query_pending: 'orange',
  awaiting_manual: 'orange', awaiting_details: 'orange', awaiting_payment: 'orange', awaiting_assets: 'orange',
  credentials_required: 'orange', unknown: 'orange', cooling: 'orange',
  // In progress.
  decided: 'blue', processing: 'blue', running: 'blue', executing: 'blue', preparing: 'blue', queued: 'blue',
  starting: 'blue', stopping: 'blue', deleting: 'blue', exiting: 'blue', draining: 'blue', paid: 'blue', in_progress: 'blue',
  // Finished with the intended result.
  approved: 'green', applied: 'green', published: 'green', active: 'green', succeeded: 'green', done: 'green',
  ready: 'green', fulfilled: 'green', delivered: 'green', used: 'green', refunded: 'green',
  // Failed, refused or needing attention.
  failed: 'red', rejected: 'red', blocked: 'red', revoked: 'red', degraded: 'red', unavailable: 'red', suspended: 'red',
};

export function stateColor(state: null | string | undefined): string | undefined {
  return state ? tones[state] : undefined;
}
