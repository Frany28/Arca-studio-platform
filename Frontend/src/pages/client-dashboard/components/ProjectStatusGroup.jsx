import { ProjectRow } from "./ProjectRow.jsx";
import Badge from "../../../components/ui/Badge/Badge.jsx";

export function ProjectStatusGroup({ group }) {
  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-[4px]">
        <Badge
          label={group.status}
          theme={group.badgeTheme}
          variation="Simple"
          size="S"
        />
      </div>
      <div className="flex flex-col">
        {group.projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}
