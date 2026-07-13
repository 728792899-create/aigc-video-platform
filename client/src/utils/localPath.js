/**
 * Hide the current operating-system account name in user-facing diagnostics.
 * The original path is kept in application state for file operations; this is
 * only a display transform so screenshots and support logs are safe to share.
 */
export function displayLocalPath(value) {
  const input = String(value || '')
  if (!input) return ''
  return input
    .replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
    .replace(/^\/home\/[^/]+(?=\/|$)/, '~')
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/i, '%USERPROFILE%')
}
