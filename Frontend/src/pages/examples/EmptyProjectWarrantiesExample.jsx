import ProjectDetailsPage from "../projects/ProjectDetailsPage.jsx";

export default function EmptyProjectWarrantiesExample() {
  return (
    <ProjectDetailsPage
      initialActiveProjectTabIndex={4}
      warrantiesProps={{ empty: true }}
    />
  );
}
