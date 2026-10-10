/**
 * Arguments for "uv run python -m photo3d_engine ...".
 * Values go in as "--name=value": a token or folder that starts with "-" must not look like an
 * option (a random base64url token starts with "-" about once in 32 launches).
 */
export function engineArgs(token: string, dataDir: string, engineId?: string): string[] {
  const args = [
    'run',
    'python',
    '-m',
    'photo3d_engine',
    `--token=${token}`,
    `--data-dir=${dataDir}`,
    // the engine stops by itself when this app is gone, even after a crash or a force quit
    '--exit-with-parent'
  ]
  if (engineId) args.push(`--engine=${engineId}`)
  return args
}
