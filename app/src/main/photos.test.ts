import { describe, expect, it } from 'vitest'
import { checkPhoto, projectName } from './photos'

describe('checkPhoto', () => {
  it('accepts supported photos in any letter case', () => {
    expect(checkPhoto('/Users/me/IMG_2041.HEIC', 1000)).toBeNull()
    expect(checkPhoto('/Users/me/chair.png', 1000)).toBeNull()
  })

  it('refuses other files, empty files and files over 50 MB', () => {
    expect(checkPhoto('/Users/me/notes.pdf', 1000)?.error).toContain('not a photo')
    expect(checkPhoto('/Users/me/chair.png', 0)?.error).toContain('empty')
    expect(checkPhoto('/Users/me/chair.png', 51 * 1024 * 1024)?.error).toContain('50 MB')
  })
})

describe('projectName', () => {
  it('uses the file name without the extension, also with spaces and Cyrillic', () => {
    expect(projectName('/Users/me/personal projects/Стол 1.jpg')).toBe('Стол 1')
  })
})
