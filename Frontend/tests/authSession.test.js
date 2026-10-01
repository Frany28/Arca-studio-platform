import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_SESSION_STATUS,
  createAuthSessionRestorer,
  loginAndConfirmSession,
  restoreAuthSession,
} from "../src/auth/authSession.js";
import { getProtectedRouteDecision } from "../src/auth/authRouteState.js";
import { resolveRouteAuthDisabledForTests } from "../src/auth/testAccess.js";

const immediateWait = () => Promise.resolve();

function setupLoginConfirmation(fetchSession) {
  const calls = [];
  const credentials = { email: "demo@example.com", password: "demo-password" };
  const login = () => loginAndConfirmSession({
    credentials,
    requestLogin: async (payload) => {
      calls.push("login");
      assert.deepEqual(payload, credentials);
      return { user: { id: 7, role: "client" } };
    },
    fetchSession: async () => {
      calls.push("me");
      return fetchSession();
    },
  });

  return { login, calls };
}

test("login rejects a login response without user before requesting the session", async () => {
  let sessionCalls = 0;

  await assert.rejects(loginAndConfirmSession({
    credentials: { email: "demo@example.com", password: "demo-password" },
    requestLogin: async () => ({}),
    fetchSession: async () => {
      sessionCalls += 1;
      return { user: { id: 7, role: "client" } };
    },
  }), {
    code: "AUTH_SESSION_MISSING",
    message: "El backend de autenticación no está actualizado.",
  });
  assert.equal(sessionCalls, 0);
});

test("login returns only the user confirmed by the session request", async () => {
  const confirmedUser = { id: 9, role: "admin" };
  const { login, calls } = setupLoginConfirmation(async () => ({
    user: confirmedUser,
  }));

  assert.equal(await login(), confirmedUser);
  assert.deepEqual(calls, ["login", "me"]);
});

test("login propagates the same 401 error without confirming authentication", async () => {
  const error = Object.assign(new Error("Sesión requerida."), {
    status: 401,
    code: "UNAUTHENTICATED",
  });
  const { login, calls } = setupLoginConfirmation(async () => {
    throw error;
  });

  await assert.rejects(login(), (received) => {
    assert.equal(received, error);
    assert.equal(received.status, 401);
    assert.equal(received.code, "UNAUTHENTICATED");
    return true;
  });
  assert.deepEqual(calls, ["login", "me"]);
});

test("login rejects a session response without user without confirming authentication", async () => {
  const { login, calls } = setupLoginConfirmation(async () => ({}));

  await assert.rejects(login(), {
    code: "AUTH_SESSION_MISSING",
    message: "No se pudo confirmar la sesión.",
  });
  assert.deepEqual(calls, ["login", "me"]);
});

test("session restoration authenticates only with a valid user response", async () => {
  const user = { id: 7, role: "client" };
  const result = await restoreAuthSession({
    fetchSession: async () => ({ user }),
    retryDelays: [],
  });

  assert.equal(result.status, AUTH_SESSION_STATUS.AUTHENTICATED);
  assert.equal(result.user, user);

  const malformed = await restoreAuthSession({
    fetchSession: async () => ({}),
    retryDelays: [],
  });
  assert.equal(
    malformed.status,
    AUTH_SESSION_STATUS.TEMPORARILY_UNAVAILABLE,
  );
});

test("only a definite 401 clears the authenticated session", async () => {
  const result = await restoreAuthSession({
    fetchSession: async () => {
      throw Object.assign(new Error("Sesión requerida."), {
        code: "UNAUTHENTICATED",
        status: 401,
      });
    },
  });

  assert.deepEqual(result, {
    status: AUTH_SESSION_STATUS.UNAUTHENTICATED,
    user: null,
  });
});

test("network and server failures retry twice and remain fail-closed", async () => {
  let calls = 0;
  const result = await restoreAuthSession({
    fetchSession: async () => {
      calls += 1;
      throw Object.assign(new Error("Temporal"), { status: 503 });
    },
    random: () => 0,
    retryDelays: [1, 1],
    wait: immediateWait,
  });

  assert.equal(calls, 3);
  assert.equal(
    result.status,
    AUTH_SESSION_STATUS.TEMPORARILY_UNAVAILABLE,
  );
  assert.equal(result.user, null);
});

test("a retry can restore the session after a transient failure", async () => {
  let calls = 0;
  const result = await restoreAuthSession({
    fetchSession: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("Temporal"), { status: 500 });
      return { user: { id: 9 } };
    },
    random: () => 0,
    retryDelays: [1, 1],
    wait: immediateWait,
  });

  assert.equal(calls, 2);
  assert.equal(result.status, AUTH_SESSION_STATUS.AUTHENTICATED);
});

test("the session restorer deduplicates requests and supports cancellation", async () => {
  let calls = 0;
  let capturedSignal;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const restorer = createAuthSessionRestorer({
    fetchSession: async ({ signal }) => {
      calls += 1;
      capturedSignal = signal;
      await pending;
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return { user: { id: 3 } };
    },
    retryDelays: [],
  });

  const first = restorer.restore();
  const second = restorer.restore();
  assert.equal(first, second);
  assert.equal(calls, 1);

  restorer.cancel();
  assert.equal(capturedSignal.aborted, true);
  release();
  await assert.rejects(first, { name: "AbortError" });
});

test("protected routes never expose content before session confirmation", () => {
  assert.equal(
    getProtectedRouteDecision({
      isAuthenticated: false,
      isLoading: true,
      isSessionUnavailable: false,
    }),
    "loading",
  );
  assert.equal(
    getProtectedRouteDecision({
      isAuthenticated: false,
      isLoading: false,
      isSessionUnavailable: true,
    }),
    "unavailable",
  );
  assert.equal(
    getProtectedRouteDecision({
      isAuthenticated: true,
      isLoading: false,
      isSessionUnavailable: false,
      role: "client",
    }),
    "content",
  );
});

test("the authentication bypass can never be enabled in production", () => {
  assert.equal(
    resolveRouteAuthDisabledForTests({ dev: false, requested: true }),
    false,
  );
  assert.equal(
    resolveRouteAuthDisabledForTests({ dev: true, requested: false }),
    false,
  );
  assert.equal(
    resolveRouteAuthDisabledForTests({ dev: true, requested: true }),
    true,
  );
});
