import { useState } from 'react'

interface UsePreviewZoomOptions {
  initial?: number
  min?: number
  max?: number
  step?: number
}

export function clampPreviewScale(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, +value.toFixed(3)))
}

export function usePreviewZoom(
  fitScale: number | null,
  resetKey: string | null,
  { initial = 1.0, min = 0.1, max = 5, step = 0.2 }: UsePreviewZoomOptions = {},
) {
  const resetToken = `${resetKey ?? ''}:${initial}`
  const [zoomState, setZoomState] = useState(() => ({
    token: resetToken,
    manualScale: initial,
    isFit: true,
  }))

  const isCurrent = zoomState.token === resetToken
  const manualScale = isCurrent ? zoomState.manualScale : initial
  const isFit = isCurrent ? zoomState.isFit : true

  const scale = clampPreviewScale(isFit && fitScale != null ? fitScale : manualScale, min, max)

  const adjustManualScale = (delta: number) => {
    setZoomState({
      token: resetToken,
      isFit: false,
      manualScale: clampPreviewScale(scale + delta, min, max),
    })
  }

  const zoomIn = () => adjustManualScale(step)
  const zoomOut = () => adjustManualScale(-step)
  const fitToWidth = () => {
    setZoomState((prev) => ({
      token: resetToken,
      manualScale: prev.token === resetToken ? prev.manualScale : initial,
      isFit: true,
    }))
  }

  const setScale = (nextScale: number) => {
    setZoomState({
      token: resetToken,
      isFit: false,
      manualScale: clampPreviewScale(nextScale, min, max),
    })
  }

  return { scale, isFit, zoomIn, zoomOut, fitToWidth, setScale }
}