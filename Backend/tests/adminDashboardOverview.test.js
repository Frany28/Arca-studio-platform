import assert from "node:assert/strict";
import test from "node:test";

import {
  mapAdminDashboardActivity,
  mapAdminDashboardRequest,
} from "../src/utils/adminDashboardOverview.js";

test("admin dashboard activity maps database rows to the public contract", () => {
  assert.deepEqual(
    mapAdminDashboardActivity({
      activity_id: "9",
      activity_kind: "status",
      activity_title: "Entrega finalizada",
      created_at: "2026-08-17T15:00:00.000Z",
      project_id: "4",
      project_name: "Quinta Bella Vista",
      user_name: "Sofía Tapia",
      user_role_code: "architect",
    }),
    {
      createdAt: "2026-08-17T15:00:00.000Z",
      id: "status-9",
      projectId: 4,
      projectName: "Quinta Bella Vista",
      title: "Entrega finalizada",
      userName: "Sofía Tapia",
      userRoleCode: "architect",
    },
  );
});

test("admin dashboard requests expose every assigned employee", () => {
  assert.deepEqual(
    mapAdminDashboardRequest({
      id: "12",
      assignees: [
        {
          id: "5",
          name: "Armando Carroz",
          roleCode: "architect",
          roleName: "Arquitecto",
        },
        {
          id: "8",
          name: "Wilmer Salas",
          roleCode: "architect",
          roleName: "Arquitecto",
        },
      ],
    }).assignees,
    [
        {
          hasProfilePhoto: false,
          id: 5,
        name: "Armando Carroz",
        roleCode: "architect",
        roleName: "Arquitecto",
      },
        {
          hasProfilePhoto: false,
          id: 8,
        name: "Wilmer Salas",
        roleCode: "architect",
        roleName: "Arquitecto",
      },
    ],
  );
});

test("admin dashboard requests map database rows to the public contract", () => {
  assert.deepEqual(
    mapAdminDashboardRequest({
      created_at: "2026-08-17T15:00:00.000Z",
      id: "12",
      project_name: "Apto. Noventa y Uno",
      project_type: "residential",
      requested_by: "41",
      status: "pending_review",
    }),
    {
      assignees: [],
      createdAt: "2026-08-17T15:00:00.000Z",
      id: 12,
      projectName: "Apto. Noventa y Uno",
      projectType: "residential",
      requestedBy: 41,
      status: "pending_review",
    },
  );
});
