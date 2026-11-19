export const GAMEBANANA_IMAGE_PROTOCOL_URL = 'media://gamebanana-image/'

export function parseGameBananaImageUrl(value: string): URL | null {
  const url = URL.parse(value, 'https://gamebanana.com/')
  if (!url || url.username || url.password) return null
  if (url.origin === 'https://images.gamebanana.com') return url
  if (url.origin === 'https://gamebanana.com' && url.pathname.startsWith('/img/')) return url
  return null
}
