import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useDashboardRequestWorkflow } from "../../../src/pages/architect-dashboard/hooks/useDashboardRequestWorkflow.js";
import ProjectRequestWorkflowModal from "../../../src/pages/architect-dashboard/components/ProjectRequestWorkflowModal.jsx";
import "../../../src/index.css";

const root = createRoot(document.getElementById("root"));
const events = [];
window.workflowHarness = { events, unmount: () => root.unmount() };

/** Monta el contrato público del hook y el modal real con callbacks observables. */
export default function WorkflowHarness() {
  const [props, setProps] = useState({
    empty: false,
    roleCode: new URLSearchParams(window.location.search).get("role") || "architect",
    firstAdminRequest: null,
  });
  const result = useDashboardRequestWorkflow({
    ...props,
    onRequestAssigneesUpdated: (id, assignees) => events.push({ type: "assignees", id, assignees }),
    onAdminDecisionCommitted: () => {
      events.push({ type: "decision" });
      if (props.callbackError) throw new Error(props.callbackError);
    },
  });
  useLayoutEffect(() => {
    window.workflowHarness.result = result;
    window.workflowHarness.setProps = (nextProps) => setProps((current) => ({ ...current, ...nextProps }));
  });
  return (
    <ProjectRequestWorkflowModal
      key={result.workflow.selectedRequest?.id || "closed"}
      mode={props.roleCode === "admin" ? "decision" : "review"}
      open={Boolean(result.workflow.selectedRequest)}
      projectRequest={result.workflow.selectedRequest}
      error={result.workflow.error}
      submitting={result.workflow.submitting}
      onClose={result.workflow.close}
      onSubmit={result.workflow.submit}
    />
  );
}

root.render(<WorkflowHarness />);
