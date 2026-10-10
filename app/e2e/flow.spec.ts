import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { _electron as electron, expect, test } from '@playwright/test'

const APP = resolve(__dirname, '..')
const PHOTO = resolve(APP, '..', 'samples', 'chair.png')

function engineRunning(dataDir: string): boolean {
  try {
    execFileSync('pgrep', ['-f', '--', `--data-dir=${dataDir}`])
    return true
  } catch {
    return false
  }
}

test('photo in, 3D model out, STL saved: no terminal needed', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'photo3d-e2e-data-'))
  const profile = mkdtempSync(join(tmpdir(), 'photo3d-e2e-profile-'))
  const saved = join(mkdtempSync(join(tmpdir(), 'photo3d-e2e-out-')), 'chair.stl')

  const app = await electron.launch({
    args: [APP, `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      PHOTO3D_ENGINE_ID: 'dummy',
      PHOTO3D_DUMMY_SECONDS: '3',
      PHOTO3D_DATA_DIR: dataDir
    }
  })
  try {
    // The native dialogs cannot be clicked: answer them from the main process.
    await app.evaluate(({ dialog, shell }, { photo, target }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [photo] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
      shell.showItemInFolder = () => undefined
    }, { photo: PHOTO, target: saved })

    const page = await app.firstWindow()

    // 1. The app starts its own engine and shows the start screen.
    await expect(page.getByText('Drop a photo here')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/^Engine \d/)).toBeVisible()

    // 2. Choose a photo: creation starts by itself and the progress screen shows.
    await page.getByRole('button', { name: 'Choose a photo…' }).click()
    await expect(page.getByText('Creating your 3D model')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Background removed')).toBeVisible({ timeout: 30_000 })

    // 3. The model appears in 3D with its panel.
    await expect(page.locator('canvas')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByText('Closed, one part')).toBeVisible()
    await expect(page.getByRole('navigation').getByText('chair')).toBeVisible()

    // 4. A new height is applied without a new AI run.
    await page.locator('.input-unit input').fill('90')
    await expect(page.getByText(/× 90 mm · about/)).toBeVisible({ timeout: 60_000 })

    // 5. Save STL writes a real file.
    await page.getByRole('button', { name: 'Save STL' }).click()
    await expect(page.getByText(`Saved: ${saved}`)).toBeVisible({ timeout: 30_000 })
    expect(existsSync(saved)).toBe(true)
    expect(statSync(saved).size).toBeGreaterThan(1000)

    expect(engineRunning(dataDir)).toBe(true)
  } finally {
    await app.close()
  }

  // 6. Closing the app leaves no engine process behind.
  for (let i = 0; i < 20 && engineRunning(dataDir); i++) await new Promise((r) => setTimeout(r, 500))
  expect(engineRunning(dataDir)).toBe(false)
})
