// Where a background task's commands are allowed to run.
//
// A background agent is the feature with the worst failure mode in this product. An agent somebody
// is watching runs a command and they see it; an agent running in a worktree while its author is in
// a meeting runs `npm install` from a package.json it just wrote, and nobody is there. So the rule
// is not "ask less because nobody is looking" — it is the opposite:
//
//   NO CONTAINER ENGINE, NO COMMANDS. `run_command` is REFUSED in background mode rather than run on
//   the host. That is the whole decision of this file, and it is the one that makes the rest
//   defensible: a background agent that can run anything on the host is a background agent nobody
//   should start.
//
// With an engine, the container is the boundary and it is drawn tight: no network at all, the
// worktree and nothing else mounted, and quotas on CPU and memory so a runaway build cannot take the
// machine down while its author is away.

export type Engine = "docker" | "podman";

/** The first engine available. Docker first only because it is the one more machines have. */
export function pickEngine(available: { docker: boolean; podman: boolean }): Engine | undefined {
  if (available.docker) return "docker";
  if (available.podman) return "podman";
  return undefined;
}

/**
 * What the model is told when there is no engine.
 *
 * It names the consequence, the reason and the two ways out, because "refused" with no next step is
 * how somebody ends up running the command by hand on the host — which is the thing being avoided.
 */
export const NO_ENGINE =
  "Refused: this is a background task and there is no container engine on this machine, so there is " +
  "nowhere safe to run a command. A background agent runs while nobody is watching, so running " +
  "commands on the host is not something this will do — the point of the container is that a command " +
  "cannot reach the network or anything outside the worktree. Install Docker or Podman, or run this " +
  "task in the foreground where you can see each command and approve it.";

export interface SandboxLimits {
  /** Fractional CPUs, as both engines spell it. */
  cpus: number;
  /** Memory, with a unit: `2g`, `512m`. */
  memory: string;
  /** Wall-clock ceiling for one command. */
  timeoutMs: number;
  /** The image commands run in. The operator's, because only they know what their build needs. */
  image: string;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  cpus: 2,
  memory: "2g",
  timeoutMs: 600_000,
  // Deliberately NOT a language image. A background task's first command is as likely to be `make`
  // as `npm test`, and guessing wrong produces "command not found" that reads as a broken feature.
  // The operator names the image their project builds in; until they do, the feature says so.
  image: "",
};

export interface SandboxRequest {
  engine: Engine;
  /** The worktree, on the host. The only path the container can see. */
  worktree: string;
  command: string;
  limits: SandboxLimits;
}

/**
 * The argv for one command in a container.
 *
 * Returned as an ARRAY and never as a shell string: the command the model wrote is passed as a
 * single argument to `sh -c` inside the container, so nothing it contains can add an argument to
 * `docker run` itself. Building this as one string and letting a shell split it is how `; --privileged`
 * in a command becomes a privileged container.
 */
export function sandboxArgv(request: SandboxRequest): string[] {
  const { worktree, command, limits } = request;
  return [
    "run",
    "--rm",
    // No network at all. Not a restricted one: a background agent has no business reaching anything,
    // and "install the dependencies" is the request that turns into arbitrary code execution.
    "--network",
    "none",
    `--cpus=${limits.cpus}`,
    `--memory=${limits.memory}`,
    // Nothing writable outside the worktree, and nothing readable either: the mount IS the sandbox.
    "--volume",
    `${worktree}:/work`,
    "--workdir",
    "/work",
    // No new privileges, and the host's user so files the command writes are not owned by root.
    "--security-opt",
    "no-new-privileges",
    limits.image,
    "sh",
    "-c",
    command,
  ];
}

/** What the result says, so a reader knows the command ran somewhere bounded. */
export function describeSandbox(request: SandboxRequest): string {
  return (
    `ran in a ${request.engine} container: no network, ${request.limits.cpus} CPU(s), ` +
    `${request.limits.memory} of memory, only ${request.worktree} mounted`
  );
}

/**
 * Is this command allowed to run at all in background mode?
 *
 * The check is about the MODE and the engine, not about the command: judging a shell string is a
 * game this project does not play (`core/ibmi/guard.ts` makes the same argument about QSH). Either
 * there is a container, in which case the command's content does not matter, or there is not, in
 * which case nothing runs.
 */
export function mayRunInBackground(input: { engine: Engine | undefined; image: string }): { allow: boolean; why?: string } {
  if (!input.engine) return { allow: false, why: NO_ENGINE };
  if (!input.image.trim()) {
    return {
      allow: false,
      why:
        "Refused: no container image is configured for background tasks, so there is nothing to run " +
        "the command in. Set hiveyCode.background.image to the image your project builds in — this " +
        "extension will not guess one, because guessing wrong produces “command not found” that reads " +
        "as a broken feature.",
    };
  }
  return { allow: true };
}
