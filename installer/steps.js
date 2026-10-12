// Small pure helpers of the installer. They have no Electron in them, so `node --test` can run them.
const path = require('node:path')

// Files that PyTorch and the compiled Python packages load from the "Visual C++ Redistributable".
// Windows 10 does not always have them (a fresh install without games or Office does not).
const VC_RUNTIME_FILES = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']

// Same numbers as in the official installer's exit codes: 0 done, 1638 a newer one is already there,
// 3010 done but a restart is advised (not needed for our use), 1641 done and restarting.
const VC_OK_CODES = [0, 1638, 3010, 1641]

// Oldest NVIDIA driver that runs the CUDA 12.x build of PyTorch on Windows (minor-version compatibility)
const MIN_NVIDIA_DRIVER = 528.33

/** Names of the Visual C++ runtime files that are missing in `system32`. `exists` is fs.existsSync. */
function missingVcRuntime(system32, exists) {
  return VC_RUNTIME_FILES.filter((name) => !exists(path.win32.join(system32, name)))
}

/** Reads the output of `nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits`. */
function parseNvidiaSmi(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((part) => part.trim())
      if (parts.length < 3) return null
      const memoryMb = Number(parts[parts.length - 1])
      const driver = parts[parts.length - 2]
      return {
        name: parts.slice(0, -2).join(', '),
        driver,
        memoryGb: Number.isFinite(memoryMb) ? Math.round(memoryMb / 102.4) / 10 : null
      }
    })
    .filter(Boolean)
}

/** One sentence about the graphics card, and whether it is a problem. */
function describeGpu(gpus) {
  if (!gpus.length) {
    return {
      ok: false,
      text: 'No NVIDIA graphics card found. photo-to-3d will use the processor, which is much slower.'
    }
  }
  const gpu = gpus[0]
  const memory = gpu.memoryGb ? `, ${gpu.memoryGb} GB` : ''
  if (parseFloat(gpu.driver) < MIN_NVIDIA_DRIVER) {
    return {
      ok: false,
      text: `${gpu.name}${memory}: the driver ${gpu.driver} is old. Update it to ${MIN_NVIDIA_DRIVER} or newer.`
    }
  }
  return { ok: true, text: `${gpu.name}${memory}, driver ${gpu.driver}` }
}

/** The percent of the engine's own download output (a line that is only "  42%"), or null. */
function percentOf(line) {
  const found = /^\s*(\d{1,3})%\s*$/.exec(String(line))
  return found ? Math.min(100, Number(found[1])) : null
}

/** True when PowerShell printed "Valid" and a Microsoft subject (see SIGNATURE_SCRIPT in main.js). */
function signedByMicrosoft(text) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim())
  return lines.includes('STATUS=Valid') && lines.some((line) => line.startsWith('SUBJECT=') && line.includes('O=Microsoft Corporation'))
}

/** Windows major version from os.release() ("10.0.19045" -> 10). Windows 7/8 are 6.x. */
function windowsMajor(release) {
  return Number(String(release).split('.')[0]) || 0
}

module.exports = {
  VC_RUNTIME_FILES,
  VC_OK_CODES,
  MIN_NVIDIA_DRIVER,
  missingVcRuntime,
  parseNvidiaSmi,
  describeGpu,
  percentOf,
  signedByMicrosoft,
  windowsMajor
}
