// 用 Electron 内置 Chromium 把 SVG 画到透明 canvas 上,导出规范 macOS 图标 PNG
// 用法: electron gen-icon.mjs <svg路径> <输出png路径>
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'

const [, , svgPath, outPath] = process.argv
const svg = readFileSync(svgPath, 'utf8')

app.whenReady().then(async () => {
  app.dock?.hide()
  const win = new BrowserWindow({ show: false, width: 200, height: 200 })
  await win.loadURL('about:blank')
  const result = await win.webContents.executeJavaScript(`(async () => {
    const svg = ${JSON.stringify(svg)}
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 1024; c.height = 1024
    const ctx = c.getContext('2d')
    // macOS 图标规范: 1024 画布,主体 824,四周 100 透明边距
    ctx.drawImage(img, 100, 100, 824, 824)
    const corner = ctx.getImageData(2, 2, 1, 1).data
    const center = ctx.getImageData(512, 512, 1, 1).data
    return {
      b64: c.toDataURL('image/png').split(',')[1],
      cornerAlpha: corner[3],
      centerPixel: Array.from(center)
    }
  })()`)
  writeFileSync(outPath, Buffer.from(result.b64, 'base64'))
  console.log(`saved ${outPath} cornerAlpha=${result.cornerAlpha} centerPixel=${result.centerPixel}`)
  app.quit()
})
