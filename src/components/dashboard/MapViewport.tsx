import { useLayoutEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { useReducedMotion } from 'framer-motion'
import { gcovManifest } from '../../services/processGCOVData'
import { gunwManifest } from '../../services/processGUNWData'
import { locationViewOptions, worldBounds, worldViewOptions } from './dashboardUtils'

/** Fit once per navigation, after the map has its final dimensions. */
export default function MapViewport({ location, onMovingChange }: {
  location: string | null
  onMovingChange: (moving: boolean) => void
}) {
  const map = useMap()
  const reduceMotion = useReducedMotion()
  const previousLocation = useRef(location)
  const previousReducedMotion = useRef(reduceMotion)
  useLayoutEffect(() => {
    const controls = [map.dragging, map.scrollWheelZoom, map.doubleClickZoom, map.touchZoom, map.keyboard]
    controls.forEach(control => location ? control.enable() : control.disable())
    return () => controls.forEach(control => control.disable())
  }, [map, location])
  useLayoutEffect(() => {
    let frame = 0
    let size = map.getSize()
    const acquisition = location ? gcovManifest[location]?.[0] ?? gunwManifest[location]?.[0] : undefined
    const moving = () => onMovingChange(true)
    const settled = () => onMovingChange(false)
    map.on('movestart', moving)
    map.on('moveend', settled)

    function fitView(animate: boolean) {
      // flyToBounds/fitBounds already cancel the previous movement. stop() also
      // resets the view and refreshes tiles before the new flight can start.
      map.invalidateSize({ animate: false, pan: false })
      size = map.getSize()
      const bounds = acquisition?.bounds ?? worldBounds
      const options = acquisition ? locationViewOptions(size.y) : worldViewOptions
      if (animate && !reduceMotion) map.flyToBounds(bounds, options)
      else map.fitBounds(bounds, { ...options, animate: false })
    }

    // MapContainer already fitted the world using the same options before paint.
    if (previousLocation.current !== location) fitView(true)
    else if (previousReducedMotion.current !== reduceMotion) fitView(false)
    previousLocation.current = location
    previousReducedMotion.current = reduceMotion

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (Math.round(width) === size.x && Math.round(height) === size.y) return
      cancelAnimationFrame(frame)
      // A late layout resize must not turn an active flight into an instant fit.
      frame = requestAnimationFrame(() => fitView(true))
    })
    observer.observe(map.getContainer())
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      map.off('movestart', moving)
      map.off('moveend', settled)
      settled()
    }
  }, [map, location, reduceMotion, onMovingChange])

  // Stop only on unmount, not during the layout change for every navigation.
  useLayoutEffect(() => () => { map.stop() }, [map])
  return null
}
