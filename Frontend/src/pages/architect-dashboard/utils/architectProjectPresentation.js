import { getProjectImageSource } from "../../../utils/projectImage.js";
import { getProjectAssigneeAvatar } from "../../../utils/projectAssigneeDisplay.js";
import { isProjectOperationallyReadOnly } from "../../../utils/projectReadOnly.js";

export function toProjectRow(project, user) {
  const assigneeAvatar = getProjectAssigneeAvatar(project);
  const isAssignedEmployee = (project.assignees || project.assignedArchitects || []).some(
    (assignee) => Number(assignee.id) === Number(user?.id),
  );

  return {
    ...project,
    assigneeAvatars: assigneeAvatar ? [assigneeAvatar] : [],
    editable:
      !isProjectOperationallyReadOnly(project) && (
        user?.role === "admin" ||
        project.assignedArchitect?.id === user?.id ||
        isAssignedEmployee
      ),
    image: getProjectImageSource(project),
    title: project.name,
  };
}
