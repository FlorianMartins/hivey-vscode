import { loadConfig } from "./config.js";

export const HELP = `Usage: fetchy [options] <path>

Options:
  --base-url <url>       API root (default https://api.example.test)
  --timeout <seconds>    give up on a request after this long (default 30)
  --retries <n>          retries after a failed request (default 2)
  --help                 this text
`;

const FLAGS = {
  "--base-url": ["baseUrl", String],
  "--timeout": ["timeout", Number],
  "--retries": ["retries", Number],
};

/** The configuration the command line asks for. */
export function configFromArgs(argv, options) {
  const raw = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = FLAGS[argv[i]];
    if (!flag) continue;
    const [key, parse] = flag;
    raw[key] = parse(argv[++i]);
  }
  return loadConfig(raw, options);
}
