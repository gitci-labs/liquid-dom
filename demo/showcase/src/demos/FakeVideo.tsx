import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import seamlessTextureUrl from '../assets/seamless.webp'
import styles from './FakeVideo.module.css'

const DURATION = 90

export type FakeVideoHandle = {
  readonly paused: boolean
  readonly duration: number
  currentTime: number
  play: () => Promise<void>
  pause: () => void
}

type FakeVideoProps = {
  className?: string
  onPause?: () => void
  onPlay?: () => void
}

export const FakeVideo = forwardRef<FakeVideoHandle, FakeVideoProps>(function FakeVideo({
  className,
  onPause,
  onPlay,
}, ref) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const textureRef = useRef<HTMLDivElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const currentTimeRef = useRef(0)
  const playingRef = useRef(false)
  const lastTickTimeRef = useRef<number | null>(null)
  const onPauseRef = useRef(onPause)
  const onPlayRef = useRef(onPlay)

  onPauseRef.current = onPause
  onPlayRef.current = onPlay

  function draw() {
    const root = rootRef.current
    const texture = textureRef.current
    if (!root || !texture) {
      return
    }

    const time = currentTimeRef.current
    const travelX = -28 + Math.sin(time * 0.19) * 5
    const travelY = -22 + Math.cos(time * 0.16) * 4
    const driftX = Math.sin(time * 0.47) * 2.5
    const driftY = Math.cos(time * 0.41) * 2.5
    const scale = 1.12 + Math.sin(time * 0.28) * 0.08

    texture.style.transform = `translate3d(${travelX + driftX}%, ${travelY + driftY}%, 0) scale(${scale})`
    root.dispatchEvent(new Event('paint', { bubbles: true }))
  }

  function stopLoop() {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }

  function tick(time: number) {
    const previousTickTime = lastTickTimeRef.current ?? time
    lastTickTimeRef.current = time
    currentTimeRef.current = (currentTimeRef.current + (time - previousTickTime) / 1000) % DURATION
    draw()

    if (playingRef.current) {
      animationFrameRef.current = requestAnimationFrame(tick)
    }
  }

  function play() {
    if (!playingRef.current) {
      playingRef.current = true
      lastTickTimeRef.current = null
      onPlayRef.current?.()
      animationFrameRef.current = requestAnimationFrame(tick)
    }

    return Promise.resolve()
  }

  function pause() {
    if (!playingRef.current) {
      return
    }

    playingRef.current = false
    lastTickTimeRef.current = null
    stopLoop()
    draw()
    onPauseRef.current?.()
  }

  function setCurrentTime(nextTime: number) {
    currentTimeRef.current = clamp(nextTime, 0, DURATION)
    draw()
  }

  useImperativeHandle(ref, () => ({
    get paused() {
      return !playingRef.current
    },
    get duration() {
      return DURATION
    },
    get currentTime() {
      return currentTimeRef.current
    },
    set currentTime(nextTime: number) {
      setCurrentTime(nextTime)
    },
    pause,
    play,
  }), [])

  useEffect(() => {
    draw()
    const textureImage = new Image()
    textureImage.onload = draw
    textureImage.src = seamlessTextureUrl
    return stopLoop
  }, [])

  return (
    <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(' ')}>
      <div
        ref={textureRef}
        className={styles.texture}
        style={{ backgroundImage: `url(${seamlessTextureUrl})` }}
      />
    </div>
  )
})

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
