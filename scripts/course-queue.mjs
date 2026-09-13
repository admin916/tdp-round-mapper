// Database RPCs own claiming, crash recovery and publication under a lease.
export async function processRequests({rest, scout, log = () => {}}, limit = 3) {
  for (let i = 0; i < limit; i++) {
    const [req] = await rest('rpc/claim_course_request', {method:'POST', body:'{}'}) || [];
    if (!req) break;
    let result;
    try {
      const row = await scout(req.name, req.place, {candidate:req.candidate});
      result = {p_course:row};
    } catch (e) {
      result = {p_error:String(e.message).slice(0,200), p_retry:e.retryable !== false};
    }
    // If publication fails, leave the lease in place for recovery. Do not mark a
    // successful map failed or publish outside the transaction as a fallback.
    const finished = await rest('rpc/finish_course_request', {method:'POST',
      body:JSON.stringify({p_id:req.id, p_lease:req.lease_token, ...result})});
    log(finished ? (result.p_course ? 'Mapped' : 'Mapping deferred') : 'Lease expired', req.name);
  }
}
