// The new app version is installed only when nothing is in flight: the sync queue (operations and uploads) is empty and the user is not in a dialog.
let pending = 0, online = true;

/** called by the sync status of the signed-in session */
export function reportSyncState(s: { pendingOps: number; pendingUploads: number; online: boolean }) { pending = s.pendingOps + s.pendingUploads; online = s.online; }

/** pure rule, also used by the tests: may the page reload into the new version now? */
export function mayReload(x: { pending: number; online: boolean; overlayOpen: boolean; hash: string }): boolean {
  // offline with pending work: keep the old page until it has been sent (nothing is lost either way: it all sits in IndexedDB)
  if (x.pending > 0) return false;
  if (x.overlayOpen) return false;
  // never in the middle of an assessment or a repair step: only on a list-like screen
  return !/^#\/(v\/|expertise|admin|s\/[^/]+\/(rep\/r\/|(kalk|rep|all)\/(v|exp|neu)))/.test(x.hash);
}

export const readyToReload = () => mayReload({ pending, online, overlayOpen: !!document.querySelector(".overlay"), hash: location.hash });
