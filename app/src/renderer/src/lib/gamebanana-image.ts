import { GAMEBANANA_IMAGE_PROTOCOL_URL, parseGameBananaImageUrl } from '@shared/gamebanana-image'

const runsInElectron = navigator.userAgent.includes('Electron')

export function gameBananaImageSrc(source: string): string {
  if (!runsInElectron) return source
  const cdnUrl = parseGameBananaImageUrl(source)
  if (!cdnUrl) return source
  return `${GAMEBANANA_IMAGE_PROTOCOL_URL}?${new URLSearchParams({ url: cdnUrl.href })}`
}
