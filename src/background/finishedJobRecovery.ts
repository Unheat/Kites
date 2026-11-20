/**
 * Decides whether a stalled job wait should defer to a job the offscreen document already finished.
 *
 * The background waits for the offscreen response channel, but the pipeline is not cancelled when
 * that wait is abandoned: it keeps working and writes its own terminal status. When the response is
 * lost (channel closed, document restarted) the wait reports "no progress" for a job that actually
 * completed, and marking it failed both lies to the user and shows an error for a translated image.
 *
 * @param errorMessage - Error text the wait produced.
 * @param storedStatus - Status currently stored for the job, if the row still exists.
 * @returns True when the job is already finished and the failure should be dropped.
 */
export function respectsFinishedJob(
  errorMessage: string,
  storedStatus: string | undefined
): boolean {
  return /made no progress/i.test(errorMessage) && storedStatus === 'completed';
}
