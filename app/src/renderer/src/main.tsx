import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installBrowserApiMock } from './lib/browser-api-mock'
import './index.css'

// 浏览器测试模式(npm run dev):不经 Electron 时 preload 不存在,注入内存 mock
if (import.meta.env.DEV && !window.api) {
  installBrowserApiMock()
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
