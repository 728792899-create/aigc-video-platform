export default {
  buildSubmit({ request, context }) {
    return {
      method: "POST",
      url: "https://relay.example.com/v1/jobs",
      headers: { "Idempotency-Key": context.key },
      authRef: "secret://relay/example",
      body: { model: request.modelId, prompt: request.prompt, media: request.media, parameters: request.parameters }
    };
  },
  parseSubmit(response) {
    return { remoteJobId: String(response.body.id), acceptedAt: "1970-01-01T00:00:00.000Z", rawStatus: String(response.body.status ?? "accepted") };
  },
  buildPoll(receipt) {
    return { method: "GET", url: `https://relay.example.com/v1/jobs/${receipt.remoteJobId}`, authRef: "secret://relay/example" };
  },
  parsePoll(response) {
    const map = { pending: "queued", running: "running", completed: "succeeded", failed: "failed" };
    return { state: map[response.body.status] ?? "outcome_unknown", rawStatus: response.body.status, outputs: response.body.outputs ?? [] };
  },
  buildCancel(receipt) {
    return { method: "POST", url: `https://relay.example.com/v1/jobs/${receipt.remoteJobId}/cancel`, authRef: "secret://relay/example" };
  },
  parseCancel() {
    return { state: "cancelled" };
  },
  buildReconcile(query) {
    const id = query.receipt?.remoteJobId ?? query.idempotencyKey;
    return { method: "GET", url: `https://relay.example.com/v1/jobs/${id}`, authRef: "secret://relay/example" };
  },
  parseReconcile(response) {
    const map = { pending: "queued", running: "running", completed: "succeeded", failed: "failed" };
    return { state: map[response.body.status] ?? "outcome_unknown", matchedBy: "remote-job-id", outputs: response.body.outputs ?? [] };
  }
};
