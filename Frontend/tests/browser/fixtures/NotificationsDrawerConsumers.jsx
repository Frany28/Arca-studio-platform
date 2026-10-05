import { AuthProvider } from "../../../src/auth/AuthContext.jsx";
import EnvironmentNotificationsDrawer from "../../../src/components/EnvironmentNotificationsDrawer.jsx";
import NotificationsDrawer from "../../../src/components/ui/NotificationsDrawer.jsx";
import { useProjectComments } from "../../../src/hooks/useProjectComments.js";
import useProjectDetailsComments from "../../../src/pages/projects/hooks/useProjectDetailsComments.js";

/** Conecta el wrapper real y el hook de proyecto usado por Home y dashboard. */
function EnvironmentConsumer(props) {
  const project = useProjectComments({ enabled: false, projectId: props.projectId === undefined ? 7 : props.projectId });
  return (
    <>
      <EnvironmentNotificationsDrawer
        {...props}
        comments={[...props.comments.filter((comment) => comment.scope !== "environment"), ...project.drawerComments]}
        commentsError={project.readError ?? project.error}
        commentsLoading={project.loading}
        onSubmitComment={project.submitComment}
      />
      <output data-consumer-error>{project.error}</output>
    </>
  );
}

/** Conecta el hook de detalles real con las mismas props públicas de su página. */
function ProjectDetailsConsumer(props) {
  const project = useProjectDetailsComments({
    isNotificationsDrawerOpen: props.open,
    project: props.project ?? { status: "in_progress" },
    resolvedProjectId: props.projectId === undefined ? 7 : props.projectId,
  });
  return (
    <>
      <NotificationsDrawer
        {...props}
        comments={project.comments.map((comment) => ({ ...comment, message: comment.content }))}
        commentsError={project.readError ?? project.error}
        commentsLoading={project.loading}
        onSubmitComment={project.submitComment}
        onSubmitEnvironmentComment={undefined}
      />
      <output data-consumer-error>{project.error}</output>
    </>
  );
}

/** Selecciona consumidores reales; únicamente la API se sustituye en el fixture. */
export default function NotificationsDrawerConsumers({ consumer, ...props }) {
  return consumer === "environment" ? (
    <AuthProvider><EnvironmentConsumer {...props} /></AuthProvider>
  ) : <ProjectDetailsConsumer {...props} />;
}
