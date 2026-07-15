import { describe, expect, it } from 'vitest'
import { displayLocalPath } from '../utils/localPath'

describe('displayLocalPath', () => {
  it('masks account names without changing app-relative URLs', () => {
    expect(displayLocalPath('/Users/alice/Downloads/movie.mp4')).toBe('~/Downloads/movie.mp4')
    expect(displayLocalPath('/home/alice/videos/movie.mp4')).toBe('~/videos/movie.mp4')
    expect(displayLocalPath('C:\\Users\\Alice\\Videos\\movie.mp4')).toBe('%USERPROFILE%\\Videos\\movie.mp4')
    expect(displayLocalPath('/uploads/videos/movie.mp4')).toBe('/uploads/videos/movie.mp4')
  })
})
