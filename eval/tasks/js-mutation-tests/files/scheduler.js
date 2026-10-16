import { parseDuration } from "./duration.js";

/** Reads the `every` field of a job definition: "every": "1h 30m". */
export function intervalOf(job) {
  return parseDuration(job.every);
}
