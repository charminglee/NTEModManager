import { session } from 'electron'
import { parseGameBananaImageUrl } from '../shared/gamebanana-image'
import { describeError, logger } from './logger'

export function gameBananaImageSession(): Electron.Session {
  return session.fromPartition('persist:gamebanana-images')
}

export async function serveGameBananaImage(request: Request): Promise<Response> {
  const source = new URL(request.url).searchParams.get('url')
  const url = source && parseGameBananaImageUrl(source)
  if (request.method !== 'GET' || !url) return new Response(null, { status: 400 })

  try {
    const response = await gameBananaImageSession().fetch(url.href, {
      cache: 'force-cache',
      credentials: 'omit',
      redirect: 'error'
    })
    const contentType = response.headers.get('content-type')
    if (!response.ok || !contentType?.startsWith('image/')) {
      await response.body?.cancel()
      return new Response(null, { status: response.ok ? 415 : response.status })
    }
    return new Response(response.body, {
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'content-security-policy': "sandbox; default-src 'none'",
        'x-content-type-options': 'nosniff'
      }
    })
  } catch (error) {
    logger.warning(`加载 GameBanana 图片失败：${url.pathname}：${describeError(error)}`)
    return new Response(null, { status: 502 })
  }
}
