import ProjectDetailsPage from "../projects/ProjectDetailsPage.jsx";

export default function EmptyProjectTrackingExample() {
  return (
    <ProjectDetailsPage
      initialActiveProjectTabIndex={3}
      trackingProps={{ empty: true }}
    />
  );
}
