export const MODEL_3D_NAVIGATION_MODES = {
  drag: {
    id: "drag",
    label: "Arrastre",
    cameraOrbit: "0deg 82deg 70%",
    fieldOfView: "44deg",
    interactionPrompt: "auto",
  },
  gyroscope: {
    id: "gyroscope",
    label: "Giroscopio",
    cameraOrbit: "0deg 82deg 70%",
    fieldOfView: "44deg",
    interactionPrompt: "none",
  },
  autorotate: {
    id: "autorotate",
    label: "Autorrotación",
    cameraOrbit: "0deg 82deg 70%",
    fieldOfView: "40deg",
    interactionPrompt: "none",
  },
};
export const MODEL_3D_TEXTURE_PRESETS = {
  auto: {
    id: "auto",
    label: "Automática",
    environmentImage: "neutral",
    shadowIntensity: "1",
    shadowSoftness: "0.6",
    exposure: "1",
    filter: "none",
    toneMapping: "neutral",
  },
  hd: {
    id: "hd",
    label: "HD",
    environmentImage: "neutral",
    shadowIntensity: "1",
    shadowSoftness: "0.4",
    exposure: "1",
    filter: "none",
    toneMapping: "neutral",
  },
  saver: {
    id: "saver",
    label: "Ahorro de datos",
    environmentImage: "neutral",
    shadowIntensity: "1",
    shadowSoftness: "1",
    exposure: "1",
    filter: "none",
    toneMapping: "neutral",
  },
};

export const MODEL_3D_CAMERA_CONTROLS = {
  interpolationDecay: "300",
  orbitSensitivity: "0.62",
  panSensitivity: "0.72",
  zoomSensitivity: "0.16",
};
