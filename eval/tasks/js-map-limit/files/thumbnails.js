import { mapLimit } from "./limit.js";

/** Renders a thumbnail per image, four at a time: the image service rate-limits above that. */
export function renderThumbnails(paths, render) {
  return mapLimit(paths, 4, (path) => render(path, { width: 320 }));
}
