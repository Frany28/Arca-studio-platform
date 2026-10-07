import assert from "node:assert/strict";
import test from "node:test";

// Opt-in: solo lecturas contra staging; no crea cuentas, notas ni solicitudes.
test("PostgreSQL y HTTP: cola identifica al solicitante y detalles devuelve identidad y errores específicos", {
  skip: process.env.ARCA_REQUEST_CLIENT_DB_TESTS !== "1",
}, async () => {
  const dotenv = await import("dotenv");
  dotenv.config({ quiet: true });
  const { query, pool } = await import("../src/config/db.js");
  const { default: app } = await import("../src/app.js");
  const { authConfig } = await import("../src/config/auth.js");
  const { createAuthToken } = await import("../src/utils/tokens.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const admins = await query(`select u.id from public.users u join public.roles r on r.id = u.role_id
      where r.code = 'admin' and u.status = 'active' and u.deleted_at is null limit 1`);
    const requests = await query(`select pr.id, pr.client_id, pr.requested_by,
      concat_ws(' ', u.first_name, u.last_name) as name, coalesce(u.company_name, c.company_name) as company_name
      from public.project_requests pr join public.users u on u.id = pr.requested_by
      left join public.clients c on c.id = u.client_id and c.deleted_at is null
      where pr.deleted_at is null and pr.status in ('pending_verification', 'pending_review')
        and u.status = 'active' and u.deleted_at is null
      order by pr.updated_at desc, pr.id desc limit 1`);
    assert.ok(admins.rows[0], "Se requiere un administrador activo de staging.");
    assert.ok(requests.rows[0], "Se requiere una solicitud pendiente de staging.");
    const request = requests.rows[0];
    const authorization = (id) => ({ Authorization: `Bearer ${createAuthToken({ sub: String(id) }, { secret: authConfig.tokenSecret, expiresInSeconds: 120 })}` });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const headers = authorization(admins.rows[0].id);
    const queue = await fetch(`${base}/project-requests/review-queue?limit=100`, { headers });
    assert.equal(queue.status, 200);
    const entry = (await queue.json()).projectRequests.find((item) => item.id === Number(request.id));
    assert.equal(entry.clientId, Number(request.client_id));
    assert.equal(entry.requestedBy, Number(request.requested_by));
    const details = await fetch(`${base}/admin/users/${entry.requestedBy}`, { headers });
    assert.equal(details.status, 200);
    const { user } = await details.json();
    assert.equal(user.id, entry.requestedBy);
    assert.equal(user.name, request.name);
    assert.equal(user.companyName, request.company_name);
    const max = await query("select coalesce(max(id), 0) + 1 as id from public.users");
    for (const [id, requestHeaders, status, code] of [
      [max.rows[0].id, headers, 404, "USER_NOT_FOUND"],
      ["undefined", headers, 400, "VALIDATION_ERROR"],
      [entry.requestedBy, {}, 401, "UNAUTHENTICATED"],
      [entry.requestedBy, authorization(entry.requestedBy), 403, "FORBIDDEN"],
    ]) {
      const response = await fetch(`${base}/admin/users/${id}`, { headers: requestHeaders });
      assert.equal(response.status, status);
      assert.equal((await response.json()).code, code);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
