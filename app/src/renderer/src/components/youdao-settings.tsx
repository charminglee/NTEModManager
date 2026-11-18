import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import type { YoudaoCredentialsStatus } from '@shared/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { toast } from './toast-card'

export default function YoudaoSettings() {
  const [status, setStatus] = useState<YoudaoCredentialsStatus>({ configured: false, appId: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')

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
    setSaving(true)
    try {
      const next = await window.api.saveYoudaoCredentials({ appId, appSecret })
      setStatus(next)
      setAppId(next.appId)
      setAppSecret('')
      toast.success('有道翻译凭据已保存')
    } catch (error) {
      toast.error('保存有道翻译凭据失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const clearCredentials = async () => {
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
            onChange={(event) => setAppId(event.target.value)}
            placeholder="请输入有道应用 ID"
            disabled={loading || saving}
          />
          <p>用于调用有道大模型翻译服务。</p>
        </div>
      </div>
      <div className="settings-field">
        <label htmlFor="youdao-app-secret">应用密钥</label>
        <div>
          <Input
            id="youdao-app-secret"
            type="password"
            autoComplete="new-password"
            value={appSecret}
            onChange={(event) => setAppSecret(event.target.value)}
            placeholder={status.configured ? '留空以保留已保存的密钥' : '请输入有道应用密钥'}
            disabled={loading || saving}
          />
          <p>密钥通过 Windows 系统加密后保存在本机，不会写入配置文件。{loading ? '正在读取凭据状态……' : status.configured ? '当前已配置。' : '当前未配置。'}</p>
        </div>
      </div>
      <div className="settings-translation-actions">
        <Button onClick={() => void saveCredentials()} disabled={loading || saving}>
          {saving ? '正在保存……' : status.configured ? '更新凭据' : '保存凭据'}
        </Button>
        {status.configured && <Button variant="outline" onClick={() => void clearCredentials()} disabled={saving}>
          清除凭据
        </Button>}
      </div>
      <div className="settings-note">
        <Info size={17} />
        社区内容仅在点击「翻译」时发送给有道，目标语言为简体中文；译文保留在原文下方。
      </div>
    </>
  )
}
