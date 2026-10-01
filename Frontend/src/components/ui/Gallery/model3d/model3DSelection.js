export function isPanoramaPointSelection(selection) {
  return ["panorama-point", "viewer3d-point"].includes(selection?.kind);
}

