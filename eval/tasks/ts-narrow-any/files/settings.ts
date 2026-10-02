// Settings as they arrive from the configuration file.

export function readSettings(raw: any): { endpoint: string; retries: number; verbose: boolean } {
  return {
    endpoint: (raw as any).endpoint as string,
    retries: (raw as any).retries as number,
    verbose: Boolean((raw as any).verbose),
  };
}
