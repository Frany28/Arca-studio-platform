import ProjectDetailsPage from "../projects/ProjectDetailsPage.jsx";
import { PROJECT_DETAIL_DATA } from "../projects/projectDetailsData.js";

const EMPTY_DOCUMENTS_PROJECT = {
  ...PROJECT_DETAIL_DATA,
  documents: [],
};

export default function EmptyProjectDocumentsExample() {
  return (
    <ProjectDetailsPage
      project={EMPTY_DOCUMENTS_PROJECT}
      initialActiveProjectTabIndex={2}
    />
  );
}
