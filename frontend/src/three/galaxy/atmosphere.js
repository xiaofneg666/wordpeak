// 大气渲染:对 MeshStandardMaterial / MeshPhysicalMaterial 用 onBeforeCompile 注入
// Fresnel rim + 极轻 hash 噪波扰 roughness,做出"月长石"质感(Fresnel 视线掠射角提亮,
// 中心/边缘色相略差)。不替换材质,保留 PBR 光照;所有效果在 lowEnd / downgraded 时
// 被 engine.applyDowngrade 还原(quality flag 控 GLSL 是否注入),中低端机走标准材质。
// 身份仍靠 sculpture 几何差(F5 的"钢与月长石"宪法);shader 只做光的增强,不动色相随机。
import * as THREE from 'three'

// 给材质注入 rim + noise 片段
export function injectAtmosphere(material, { color = 0x9fb2cc, power = 2.4, strength = 0.55, noiseAmp = 0.06 } = {}) {
  if (!material || !material.isShaderMaterial && !(material.onBeforeCompile)) return
  if (material.userData.atmInjected) return
  material.userData.atmInjected = true

  const colorVec = new THREE.Color(color)
  const uniforms = {
    uAtmColor: { value: colorVec },
    uAtmPower: { value: power },
    uAtmStrength: { value: strength },
    uNoiseAmp: { value: noiseAmp },
  }
  material.userData.atmUniforms = uniforms

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    // vertex: 暴露法线 + 屏幕空间法线(rim 算式)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vAtmViewNormal;
        varying vec3 vAtmWorldNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vAtmViewNormal = normalize(normalMatrix * normal);
        vAtmWorldNormal = normalize(mat3(modelMatrix) * normal);`)
    // fragment: rim + roughness 扰动
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uAtmColor;
        uniform float uAtmPower;
        uniform float uAtmStrength;
        uniform float uNoiseAmp;
        varying vec3 vAtmViewNormal;
        varying vec3 vAtmWorldNormal;
        float atmHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // 极轻 hash 噪波扰 roughness,做成月长石的不均匀感
        roughnessFactor += (atmHash(vAtmWorldNormal * 12.7) - 0.5) * uNoiseAmp;
        roughnessFactor = clamp(roughnessFactor, 0.0, 1.0);
      `)
      // Fresnel rim(视线掠射角):仅在 body 颜色上叠加,emissive 不动。
      // 注意两个坑:① r155 起 chunk 名从 output_fragment 改为 opaque_fragment,
      // 旧名 replace 匹配不到任何内容,rim 从未注入过(静默死代码);
      // ② 必须放在 include 之后——opaque_fragment 内部对 gl_FragColor 整体赋值,
      // 先加后赋会被整体覆盖
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float atmNdv = clamp(dot(normalize(vAtmViewNormal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
        float rim = pow(1.0 - atmNdv, uAtmPower);
        gl_FragColor.rgb += uAtmColor * rim * uAtmStrength;
      `)
  }
  // 标记 material 需要重编译
  material.needsUpdate = true
  return uniforms
}
