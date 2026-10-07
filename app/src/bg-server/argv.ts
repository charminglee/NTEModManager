// 依赖顺序关键:本模块必须先于 config 相关模块执行(打包产物为 CJS,按 import 顺序加载),
// 把 --config=<路径> 指定的主程序 ini 写入 NTEMM_CONFIG,供 configFilePath() 解析。
// 服务 exe 与主程序不同目录部署时,用该参数指回主程序的 NteModManager.ini。
for (const arg of process.argv.slice(1)) {
  const match = /^--config=(.+)$/.exec(arg)
  if (match) {
    process.env.NTEMM_CONFIG = match[1]
    break
  }
}
