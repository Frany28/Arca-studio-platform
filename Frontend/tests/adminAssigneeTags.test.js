import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("architect dashboard assignment areas use the shared tag selector with avatars", async () => {
  const [activeProjects, overview] = await Promise.all([
    readFile(
      new URL(
        "../src/pages/architect-dashboard/components/AdminActiveProjects.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/pages/architect-dashboard/components/AdminDashboardOverview.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(activeProjects, /<AssigneeMultiSelect/);
  assert.doesNotMatch(activeProjects, /showTagAvatars=\{false\}/);
  assert.match(overview, /<AssigneeMultiSelect/);
});

test("admin assignees receive authenticated profile photos with initials fallback", async () => {
  const [httpSource, selectorSource, avatarConfigSource] = await Promise.all([
    readFile(new URL("../src/api/adminApi.js", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../src/components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/components/ui/Avatar/avatarConfig.js", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(httpSource, /withAdminAssigneeAvatars/);
  assert.match(httpSource, /\/admin\/assignees\/\$\{encodeURIComponent\(assignee\.id\)\}\/profile-photo/);
  assert.match(selectorSource, /profilePhotoUrl \|\| person\.avatarUrl/);
  assert.match(selectorSource, /getInitials\(person\.name\)/);
  assert.match(avatarConfigSource, /XS:[\s\S]*size-\[16px\]/);
});

test("the temporary input tags route is no longer registered", async () => {
  const mainSource = await readFile(
    new URL("../src/main.jsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(mainSource, /InputTagsShowcase/);
  assert.doesNotMatch(mainSource, /componentes\/input-tags/);
});

test("assignee suggestions overlay their container without changing table row height", async () => {
  const [selectorSource, inputSource, groupSource] = await Promise.all([
    readFile(
      new URL(
        "../src/components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/components/ui/Input/Input.jsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/ui/Input/tags/InputTagGroup.jsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(selectorSource, /tagGroupPlacement="overlay"/);
  assert.match(inputSource, /showTagGroupAsOverlay/);
  assert.match(groupSource, /absolute left-0 top-full/);
});
