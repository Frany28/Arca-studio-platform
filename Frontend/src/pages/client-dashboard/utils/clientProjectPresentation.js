import { getProjectImageSource } from "../../../utils/projectImage.js";
import { getProjectAssigneeAvatar } from "../../../utils/projectAssigneeDisplay.js";

export function getProjectAssigneeAvatars(project) {
  const assigneeAvatar = getProjectAssigneeAvatar(project);
  return assigneeAvatar ? [assigneeAvatar] : [];
}

export function toProjectRow(project) {
  return {
    ...project,
    assigneeAvatars: getProjectAssigneeAvatars(project),
    image: getProjectImageSource(project),
    title: project.name,
  };
}
