import assert from "node:assert/strict";
import test from "node:test";

import { MEETING_RECOMMENDATIONS } from "../../Backend/src/domain/projectRequestReview.js";
import { projectRequestsApi } from "../src/api/projectRequestsApi.js";
import { MEETING_RECOMMENDATION_OPTIONS } from "../src/utils/projectRequestMeetingRecommendation.js";

test("el mapping visible cubre exactamente el dominio backend sin redefinir un enum frontend", () => {
  assert.deepEqual(MEETING_RECOMMENDATION_OPTIONS.map((option) => option.value), MEETING_RECOMMENDATIONS);
});

for (const meetingRecommendation of [...MEETING_RECOMMENDATIONS, null, undefined]) {
  test(`la API conserva la decisión de reunión ${String(meetingRecommendation)} separada del workflow`, async (context) => {
    let received;
    const review = { recommendation: "reject", meetingRecommendation: meetingRecommendation ?? null };
    context.mock.method(globalThis, "fetch", async (url, options) => {
      received = { url, ...options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ review }), { headers: { "Content-Type": "application/json" } });
    });
    assert.deepEqual(await projectRequestsApi.review({ projectRequestId: 12, note: "Justificación independiente.", recommendation: "reject", meetingRecommendation }), { review });
    assert.equal(received.url, "/api/project-requests/12/review");
    assert.equal(received.method, "PUT");
    assert.equal(received.credentials, "include");
    assert.equal(received.body.recommendation, "reject");
    assert.equal(received.body.meetingRecommendation, meetingRecommendation);
    assert.equal(Object.hasOwn(received.body, "meetingRecommendation"), meetingRecommendation !== undefined);
  });
}
