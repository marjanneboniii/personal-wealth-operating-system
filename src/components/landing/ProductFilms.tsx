"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore, type RefObject } from "react";
import Icon from "@/components/ui/Icon";
import { PRODUCT_FILM_CHAPTERS, PRODUCT_PREVIEW_CHAPTERS, PRODUCT_FILM_TOPICS, PRODUCT_FILMS, PRODUCT_PREVIEW, type ProductFilmVariant } from "@/lib/productFilms";

type Film = { label: string; src: string; poster: string; width: number; height: number };
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const fa = (value: number) => String(value).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

function FilmPlayer({ film, videoRef, pendingRef, captions, chapters, onTime, onPlay }: {
  film: Film; videoRef: RefObject<HTMLVideoElement | null>; pendingRef: RefObject<number | null>; captions: string; chapters: readonly { at: number; caption: string }[]; onTime: (time: number) => void; onPlay: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const enhanced = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [captionsOn, setCaptionsOn] = useState(false);
  const captionText = chapters[Math.max(0, chapters.findLastIndex(item => time >= item.at))]?.caption ?? "";
  const playerRef = useRef<HTMLElement>(null);
  const stamp = (seconds: number) => `${fa(Math.floor(seconds / 60))}:${fa(Math.floor(seconds % 60)).padStart(2, "۰")}`;
  return <figure className="product-films-player" ref={playerRef}>
    <video ref={videoRef} controls={!enhanced} playsInline preload="none" poster={film.poster} width={film.width} height={film.height}
      aria-label={film.label} onPlay={() => { setPlaying(true); onPlay(); }} onPause={event => { setPlaying(false); setTime(event.currentTarget.currentTime); }} onEnded={event => { setPlaying(false); setTime(event.currentTarget.currentTime); }}
      onSeeked={event => setTime(event.currentTarget.currentTime)}
      onTimeUpdate={event => { setTime(event.currentTarget.currentTime); onTime(event.currentTarget.currentTime); }}
      onLoadedMetadata={event => {
        setDuration(event.currentTarget.duration);
        if (enhanced && event.currentTarget.textTracks[0]) event.currentTarget.textTracks[0].mode = "hidden";
        if (pendingRef.current !== null) { event.currentTarget.currentTime = pendingRef.current; pendingRef.current = null; }
      }} onError={() => setFailed(true)}>
      <source src={film.src} type="video/mp4" />
      <track kind="captions" src={captions} srcLang="fa" label="زیرنویس فارسی" />
      مرورگر شما پخش ویدیو را پشتیبانی نمی‌کند. <a href={film.src}>دریافت ویدیو</a>
    </video>
    {enhanced && <>
      <div className="product-film-controls" role="group" aria-label={`کنترل پخش ${film.label}`}>
        <button type="button" aria-label={playing ? "توقف ویدیو" : "پخش ویدیو"} onClick={() => {
          const video = videoRef.current;
          if (!video) return;
          if (video.paused) void video.play().catch(() => setFailed(true)); else video.pause();
        }}>{playing ? "توقف" : "پخش"}</button>
        <input type="range" aria-label="زمان ویدیو" dir="ltr" min={0} max={duration || 1} step={.1} value={time}
          disabled={!duration} aria-valuetext={`${stamp(time)} از ${stamp(duration)}`} onChange={event => {
            const next = Number(event.currentTarget.value);
            setTime(next);
            if (videoRef.current) videoRef.current.currentTime = next;
          }} />
        <span dir="ltr">{stamp(time)} / {stamp(duration)}</span>
        <button type="button" aria-label="زیرنویس فارسی" aria-pressed={captionsOn} onClick={() => {
          if (videoRef.current?.textTracks[0]) videoRef.current.textTracks[0].mode = "hidden";
          setCaptionsOn(!captionsOn);
        }}>CC</button>
        <button type="button" aria-label="نمایش تمام‌صفحه" onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          else void playerRef.current?.requestFullscreen?.().catch(() => {});
        }}>⛶</button>
      </div>
      {captionsOn && <p className="product-film-caption" dir="rtl">{captionText || "زیرنویس فارسی روشن است."}</p>}
    </>}
    <figcaption>نمایش محصول با داده‌های فرضی</figcaption>
    {failed && <p className="product-films-error" role="status">ویدیو بارگذاری نشد. <a href={film.src} download>دریافت فایل ویدیو</a></p>}
  </figure>;
}

export default function ProductFilms({ setupSteps }: { setupSteps: { title: string; body: string }[] }) {
  const [topic, setTopic] = useState(0);
  const [variant, setVariant] = useState<ProductFilmVariant>("pwa");
  const [guideOpen, setGuideOpen] = useState(false);
  const [chapter, setChapter] = useState(0);
  const previewRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLVideoElement>(null);
  const previewSeekRef = useRef<number | null>(null);
  const guideSeekRef = useRef<number | null>(null);

  const variantChosenRef = useRef(false);

  const seek = (ref: RefObject<HTMLVideoElement | null>, pendingRef: RefObject<number | null>, at: number) => {
    const video = ref.current;
    if (!video) return;
    // Seek into a readable frame, after the brief scene transition.
    const time = at + .3;
    if (video.readyState >= 1) video.currentTime = time;
    else { pendingRef.current = time; video.load(); }
    void video.play().catch(() => { /* Playback can also be started through the player controls. */ });
  };

  return <section className="landing-band-surface" id="product-tour" aria-labelledby="product-films-title">
    <div className="landing-wrap landing-section">
      <p className="landing-eyebrow">توازن در عمل</p>
      <h2 id="product-films-title" className="landing-h2">پول، قسط و سرمایه‌تان؛ روشن و یک‌جا.</h2>
      <p className="landing-support">در ۲۰ ثانیه ببینید توازن چه چیزی را برای شما روشن می‌کند.</p>
      <div className="product-films-layout">
        <div className="product-films-story">
          <div className="product-films-topics" role="group" aria-label="موضوع نمایش کوتاه">
            {PRODUCT_FILM_TOPICS.map((item, index) => <button type="button" key={item.title} aria-pressed={topic === index}
              onClick={() => { guideRef.current?.pause(); setTopic(index); seek(previewRef, previewSeekRef, item.previewAt); }}>
              <Icon name={item.icon} size={20} /><span>{item.title}</span>
            </button>)}
          </div>
          <p className="product-films-description">{PRODUCT_FILM_TOPICS[topic].description}</p>
          <div className="product-films-cta">
            <Link href="/register" className="btn btn-primary">شروع رایگان<Icon name="arrow-start" size={18} /></Link>
            <span>بدون نیاز به کارت بانکی</span>
          </div>
          <p className="product-films-everyday">دخل‌وخرج ماه و فاصله تا سقف بودجه را هم می‌بینید.</p>
          <p className="product-films-note">توازن پرداخت انجام‌شده را ثبت می‌کند و پولی جابه‌جا نمی‌کند.</p>
        </div>
        <FilmPlayer key="preview" film={PRODUCT_PREVIEW} videoRef={previewRef} pendingRef={previewSeekRef} captions="/videos/tavazon/preview.fa.vtt" chapters={PRODUCT_PREVIEW_CHAPTERS} onPlay={() => guideRef.current?.pause()}
          onTime={time => setTopic(Math.max(0, PRODUCT_FILM_TOPICS.findLastIndex(item => time >= item.previewAt)))} />
      </div>
      <details className="product-films-guide" id="how" onToggle={event => {
        const open = event.currentTarget.open;
        setGuideOpen(open);
        if (open) {
          previewRef.current?.pause();
          setChapter(0);
          if (!variantChosenRef.current) {
            setVariant(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone || !window.matchMedia("(min-width: 768px)").matches ? "pwa" : "web");
            variantChosenRef.current = true;
          }
        }
        else { guideRef.current?.pause(); guideSeekRef.current = null; }
      }}>
        <summary><span><b>راهنمای کامل گوشی و وب</b><small>۴۰ ثانیه · از راه‌اندازی اولیه تا سبد دارایی</small></span><Icon name="chevronDown" size={20} /></summary>
        {guideOpen && <div className="product-films-guide-body">
          <div className="product-films-guide-toolbar">
            <div className="product-films-switch" role="group" aria-label="نسخهٔ راهنمای کامل">
              {(Object.keys(PRODUCT_FILMS) as ProductFilmVariant[]).map(key => <button type="button" key={key} aria-pressed={variant === key}
                onClick={() => { if (variant === key) return; guideRef.current?.pause(); guideSeekRef.current = null; setVariant(key); setChapter(0); }}>
                <Icon name={key === "pwa" ? "phone" : "globe"} size={18} />{PRODUCT_FILMS[key].label}
              </button>)}
            </div>
            <a className="product-films-download" href={PRODUCT_FILMS[variant].src} download>دریافت ویدیوی {PRODUCT_FILMS[variant].label}</a>
          </div>
          <div className="product-films-guide-layout" data-variant={variant}>
            <FilmPlayer key={variant} film={PRODUCT_FILMS[variant]} videoRef={guideRef} pendingRef={guideSeekRef} captions="/videos/tavazon/captions.fa.vtt" chapters={PRODUCT_FILM_CHAPTERS} onPlay={() => previewRef.current?.pause()}
              onTime={time => setChapter(Math.max(0, PRODUCT_FILM_CHAPTERS.findLastIndex(item => time >= item.at)))} />
            <div className="product-films-guide-copy">
              <h3>شروع، ساده‌تر از یک فایل اکسل.</h3>
              <ol className="product-films-setup">{setupSteps.map((item, index) => <li key={item.title}><span>{fa(index + 1)}</span><div><b>{item.title}</b><p>{item.body}</p></div></li>)}</ol>
              <details className="product-films-chapter-disclosure">
                <summary>انتخاب مرحلهٔ راهنما<Icon name="chevronDown" size={16} /></summary>
                <ol className="product-films-chapters" aria-label="مرحله‌های راهنمای کامل">{PRODUCT_FILM_CHAPTERS.map((item, index) => <li key={item.at}>
                  <button type="button" aria-current={chapter === index ? "step" : undefined} onClick={() => seek(guideRef, guideSeekRef, item.at)}>
                    <span>{item.title}</span><small dir="ltr">۰:{fa(item.at).padStart(2, "۰")}</small>
                  </button>
                </li>)}</ol>
              </details>
              <Link href="/register" className="btn btn-primary">شروع رایگان<Icon name="arrow-start" size={18} /></Link>
            </div>
          </div>
        </div>}
      </details>
    </div>
  </section>;
}
