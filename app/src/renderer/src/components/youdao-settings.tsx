import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { YoudaoCredentialsStatus } from '@shared/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { toast } from './toast-card'

const SAVE_DEBOUNCE_MS = 500

export default function YoudaoSettings() {
  const [status, setStatus] = useState<YoudaoCredentialsStatus>({ configured: false, appId: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const saveTimeoutRef = useRef<number | null>(null)
  const pendingCredentialsRef = useRef<{ appId: string; appSecret: string } | null>(null)

  useEffect(() => {
    let active = true
    void window.api.getYoudaoCredentialsStatus().then((credentialsStatus) => {
      if (!active) return
      setStatus(credentialsStatus)
      setAppId(credentialsStatus.appId)
    }).catch((error) => {
      if (active) toast.error('读取有道翻译设置失败', { description: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  const saveCredentials = async () => {
    const credentials = pendingCredentialsRef.current
    if (!credentials) return
    pendingCredentialsRef.current = null
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    setSaving(true)
    try {
      const next = await window.api.saveYoudaoCredentials(credentials)
      setStatus(next)
      setAppId(next.appId)
      if (credentials.appSecret) setAppSecret('')
    } catch (error) {
      toast.error('保存有道翻译凭据失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const scheduleSave = (nextAppId: string, nextAppSecret: string) => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    if (!nextAppId.trim() || (!nextAppSecret.trim() && !status.configured)) {
      pendingCredentialsRef.current = null
      return
    }
    pendingCredentialsRef.current = { appId: nextAppId, appSecret: nextAppSecret }
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null
      void saveCredentials()
    }, SAVE_DEBOUNCE_MS)
  }

  const clearCredentials = async () => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    pendingCredentialsRef.current = null
    setSaving(true)
    try {
      const next = await window.api.clearYoudaoCredentials()
      setStatus(next)
      setAppId('')
      setAppSecret('')
      toast.success('已清除有道翻译凭据')
    } catch (error) {
      toast.error('清除有道翻译凭据失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="settings-field">
        <label htmlFor="youdao-app-id">应用 ID</label>
        <div>
          <Input
            id="youdao-app-id"
            autoComplete="off"
            value={appId}
            onChange={(event) => {
              const value = event.target.value
              setAppId(value)
              scheduleSave(value, appSecret)
            }}
            onBlur={() => void saveCredentials()}
            placeholder="请输入有道应用 ID"
            disabled={loading || saving}
          />
          <p>请填写已开通有道大模型翻译服务的应用 ID。</p>
        </div>
      </div>
      <div className="settings-field">
        <label htmlFor="youdao-app-secret">应用密钥</label>
        <div>
          <div className="settings-input-row">
            <Input
              id="youdao-app-secret"
              type="password"
              autoComplete="new-password"
              value={appSecret}
              onChange={(event) => {
                const value = event.target.value
                setAppSecret(value)
                scheduleSave(appId, value)
              }}
              onBlur={() => void saveCredentials()}
              placeholder={status.configured ? '留空以保留已保存的密钥' : '请输入有道应用密钥'}
              disabled={loading || saving}
            />
            {status.configured && (
              <Button type="button" variant="outline" onClick={() => void clearCredentials()} disabled={saving}>
                <Trash2 aria-hidden="true" />
                清除凭据
              </Button>
            )}
          </div>
          <p>{loading ? '正在读取凭据状态……' : saving ? '正在自动保存……' : status.configured ? '凭据已配置。' : '填写 ID 和密钥后自动保存。'}</p>
        </div>
      </div>
    </>
  )
}
