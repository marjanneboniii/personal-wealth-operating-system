"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import Icon from "@/components/ui/Icon";
import { PRODUCT_PREVIEW_CHAPTERS, PRODUCT_FILM_TOPICS, PRODUCT_PREVIEW } from "@/lib/productFilms";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Data Saver (Android Chrome, PWA on mobile data): never start a multi-megabyte download unasked. */
const savesData = () => typeof navigator !== "undefined" && Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);

/**
 * The preview is a silent motion graphic (rendered by motion/), not a film to
 * operate: no player controls. It loops while on screen and pauses off screen.
 * Reduced-motion and Data Saver visitors see the poster; topic buttons still play a scene.
 * Before hydration the native controls remain as a no-JavaScript fallback.
 */
function MotionPreview({ videoRef, pendingRef, onTime }: {
  videoRef: RefObject<HTMLVideoElement | null>; pendingRef: RefObject<number | null>; onTime: (time: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const enhanced = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || prefersReducedMotion() || savesData()) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void video.play().catch(() => { /* Autoplay can be refused; the poster stays. */ });
      else video.pause();
    }, { threshold: .35 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [videoRef]);

  return <figure className="product-films-player">
    <video ref={videoRef} controls={!enhanced} muted loop playsInline preload="none" poster={PRODUCT_PREVIEW.poster}
      width={PRODUCT_PREVIEW.width} height={PRODUCT_PREVIEW.height}
      aria-label={`${PRODUCT_PREVIEW.label}: ${PRODUCT_PREVIEW_CHAPTERS.map(c => c.caption).join(" ")}`}
      onTimeUpdate={event => onTime(event.currentTarget.currentTime)}
      onLoadedMetadata={event => {
        if (pendingRef.current !== null) { event.currentTarget.currentTime = pendingRef.current; pendingRef.current = null; }
      }} onError={() => setFailed(true)}>
      <source src={PRODUCT_PREVIEW.src} type="video/mp4" />
    </video>
    {failed && <p className="product-films-error" role="status">نمایش بارگذاری نشد.</p>}
  </figure>;
}

export default function ProductFilms() {
  const [topic, setTopic] = useState(0);
  const previewRef = useRef<HTMLVideoElement>(null);
  const previewSeekRef = useRef<number | null>(null);

  const seek = (at: number) => {
    const video = previewRef.current;
    if (!video) return;
    // Land just after the camera move, so the scene builds in front of the viewer.
    const time = at + .4;
    if (video.readyState >= 1) video.currentTime = time;
    else { previewSeekRef.current = time; video.load(); }
    if (!prefersReducedMotion()) void video.play().catch(() => {});
  };

  return <section className="landing-band-surface" id="product-tour" aria-labelledby="product-films-title">
    <div className="landing-wrap landing-section">
      <p className="landing-eyebrow">توازن در عمل</p>
      <h2 id="product-films-title" className="landing-h2">ببینید هر عدد از کجا می‌آید. <span className="landing-h2-quiet">ارزش خالص، خرج ماه، قسط و سرمایه، در ۲۰ ثانیه.</span></h2>
      <p className="landing-support">نمایش با داده‌های فرضی.</p>
      {/* Cinema width: the film spans the content column (not the viewport), so its
          text stays legible and the page keeps its rhythm. Topics sit under it. */}
      <div className="product-films-layout">
        <MotionPreview videoRef={previewRef} pendingRef={previewSeekRef}
          onTime={time => setTopic(Math.max(0, PRODUCT_FILM_TOPICS.findLastIndex(item => time >= item.previewAt)))} />
        <div className="product-films-story">
          <div className="product-films-topics" role="group" aria-label="موضوع نمایش کوتاه">
            {PRODUCT_FILM_TOPICS.map((item, index) => <button type="button" key={item.title} aria-pressed={topic === index}
              onClick={() => { setTopic(index); seek(item.previewAt); }}>
              <Icon name={item.icon} size={20} /><span>{item.title}</span>
            </button>)}
          </div>
          <p className="product-films-description">{PRODUCT_FILM_TOPICS[topic].description}</p>
          <div className="product-films-cta">
            <Link href="/register" className="btn btn-primary">شروع رایگان<Icon name="arrow-start" size={18} /></Link>
            <span>رایگان، روی گوشی و کامپیوتر</span>
          </div>
          <p className="product-films-note">توازن پرداخت انجام‌شده را ثبت می‌کند و پولی جابه‌جا نمی‌کند.</p>
        </div>
      </div>
    </div>
  </section>;
}
