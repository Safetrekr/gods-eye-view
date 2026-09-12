import * as Cesium from 'cesium';
import { retroShader } from '../styles/retro.js';
import { nightVisionShader } from '../styles/surveillance.js';
import { thermalShader } from '../styles/thermal.js';
import { noirShader } from '../styles/noir.js';
import { snowShader } from '../styles/snow.js';
import { animeShader } from '../styles/anime.js';

export const VISUAL_MODES = [
  { id: 'normal', label: 'Natural', detail: 'Original map imagery' },
  { id: 'surveillance', label: 'Night vision', detail: 'Green phosphor' },
  { id: 'thermal', label: 'FLIR', detail: 'White hot' },
  { id: 'blackhot', label: 'FLIR', detail: 'Black hot' },
  { id: 'ironbow', label: 'Ironbow', detail: 'Thermal color effect' },
  { id: 'retro', label: 'CRT', detail: 'Analog display' },
  { id: 'noir', label: 'Noir', detail: 'Monochrome' },
  { id: 'snow', label: 'Snow', detail: 'Atmospheric effect' },
  { id: 'anime', label: 'Illustrated', detail: 'Cel shading' },
];

/** Only the globe is shaded; staff controls retain their accessible colors. */
export function createVisualModes(viewer) {
  const shaders = {
    retro: retroShader,
    surveillance: nightVisionShader,
    thermal: thermalShader,
    noir: noirShader,
    snow: snowShader,
    anime: animeShader,
  };
  const stages = new Map();
  let active = 'normal';
  let strength = 1;
  const started = performance.now();
  const animate = viewer.scene.preRender.addEventListener(() => {
    const stage = stages.get(
      ['blackhot', 'ironbow'].includes(active) ? 'thermal' : active,
    );
    if (stage?.enabled && 'time' in stage.uniforms)
      stage.uniforms.time = matchMedia('(prefers-reduced-motion: reduce)')
        .matches
        ? 0
        : (performance.now() - started) / 1000;
  });
  return {
    get active() {
      return active;
    },
    setMode(id) {
      if (!VISUAL_MODES.some((mode) => mode.id === id)) return false;
      const key = ['blackhot', 'ironbow'].includes(id) ? 'thermal' : id;
      if (key !== 'normal' && !stages.has(key)) {
        const shader = shaders[key];
        const uniforms = { intensity: strength };
        if (shader.fragmentShader.includes('uniform float time'))
          uniforms.time = 0;
        for (const [name, meta] of Object.entries(shader.uniforms || {}))
          uniforms[name] = meta.default;
        const stage = new Cesium.PostProcessStage({
          name: `safetrekr_${key}`,
          fragmentShader: shader.fragmentShader,
          uniforms,
        });
        viewer.scene.postProcessStages.add(stage);
        stages.set(key, stage);
      }
      for (const [name, stage] of stages)
        stage.enabled = name === key && strength > 0;
      if (key === 'thermal') {
        stages.get(key).uniforms.mode = id === 'blackhot' ? 1 : 0;
        stages.get(key).uniforms.palette = id === 'ironbow' ? 1 : 0;
      }
      active = id;
      document.documentElement.dataset.gevStyle = key;
      window.dispatchEvent(
        new CustomEvent('gev:style-change', { detail: { style: key } }),
      );
      viewer.scene.requestRender();
      return true;
    },
    setStrength(value) {
      strength = Math.max(0, Math.min(1, Number(value) || 0));
      for (const stage of stages.values()) stage.uniforms.intensity = strength;
      this.setMode(active);
    },
    dispose() {
      animate();
      for (const stage of stages.values())
        viewer.scene.postProcessStages.remove(stage);
      stages.clear();
      delete document.documentElement.dataset.gevStyle;
    },
  };
}
