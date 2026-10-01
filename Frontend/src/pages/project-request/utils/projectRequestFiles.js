export function toFileItems(fileList) {
  return Array.from(fileList || []).map((file, index) => ({
    error: "",
    file,
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    progress: 0,
    status: "pending",
  }));
}
