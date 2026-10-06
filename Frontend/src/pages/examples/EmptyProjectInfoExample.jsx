import ProjectDetailsPage from "../projects/ProjectDetailsPage.jsx";

export default function EmptyProjectInfoExample() {
  return (
    <ProjectDetailsPage
      initialActiveProjectTabIndex={0}
      infoProps={{ empty: true }}
    />
  );
}
