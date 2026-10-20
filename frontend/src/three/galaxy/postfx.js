// 后期:Bloom 提档 + DOF 焦散 + 输出
//   strength 0.7 / threshold 0.55:高光和灯点起明确柔晕,亮部"烧"起来
//   DOF:进词卡时焦散到虚化;航行中关闭(移动 + DOF = 糊 + 贵)。lowEnd/降级时一律关。
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

// pixelRatio 由调用方(engine)传入,与 renderer 保持一致:lowEnd 判 1x 时 composer
// 若仍按 min(dpr,2) 渲,RenderPass 会在 2x 目标上渲 4 倍像素再降采样输出到 1x 画布,
// 低端机反而成了渲最多像素的那台
export function createComposer(renderer, scene, camera, { w, h, pixelRatio = Math.min(window.devicePixelRatio, 2), bloom = true, dof = false } = {}) {
  const composer = new EffectComposer(renderer)
  composer.setSize(w)
  composer.setPixelRatio(pixelRatio)

  composer.addPass(new RenderPass(scene, camera))

  let bloomPass = null
  if (bloom) {
    bloomPass = new UnrealBloomPass({ x: w, y: h }, 0.7, 0.8, 0.55)
    composer.addPass(bloomPass)
  }

  let bokeh = null
  if (dof) {
    // focus 距离由外部 engine 在 tick / focusOn / resumeFlight 时同步(bokeh.uniforms.focus)
    bokeh = new BokehPass(scene, camera, {
      focus: 32,
      aperture: 0.0023,
      maxblur: 0.012,
    })
    composer.addPass(bokeh)
  }

  composer.addPass(new OutputPass())
  return {
    composer,
    bloom: bloomPass,
    bokeh,
    setFocus(distance) { if (bokeh) bokeh.uniforms.focus.value = distance },
    setEnabled(on) {
      if (bokeh) bokeh.enabled = on
    },
  }
}
