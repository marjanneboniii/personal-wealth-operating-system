"use client";

import { useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/layout/BrandMark";

export default function WatchPage() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--cloud)] text-[var(--ink)]">
      {/* ───────────────── Minimal Header ───────────────── */}
      <header className="site-header watch-header">
        <div className="container">
          <Link href="/" className="brand" aria-label="توازن — بازگشت به صفحه اصلی">
            <BrandMark framed size={34} />
            <span className="font-extrabold text-[1.05rem]">توازن</span>
          </Link>
          <nav className="main-nav" aria-label="ناوبری صفحه تماشا">
            <Link href="/">صفحهٔ اصلی</Link>
            <Link href="/#modules">بخش‌ها و قابلیت‌ها</Link>
            <Link href="/#insights">راهنماها</Link>
          </nav>
          <div className="header-actions">
            <span className="badge hidden sm:inline-flex">✧ نسخه ابری امن</span>
            <a href="#gate" className="btn btn-primary">
              ورود و ثبت‌نام
            </a>
          </div>
        </div>
      </header>

      {/* ───────────────── Hero ───────────────── */}
      <section className="watch-hero container">
        <span className="eyebrow">
          <span className="dot"></span> مستند کامل و تور تعاملی توازن
        </span>
        <h1>مسیر صفر تا صد انضباط مالی و ثبت دارایی‌های شخصی</h1>
      </section>

      {/* ───────────────── Video / Interactive Player ───────────────── */}
      <div className="player container" role="region" aria-label="پخش‌کننده ویدیو و تور تعاملی">
        <div className={`player-stage ${isPlaying ? "is-playing" : ""}`}>
          <button
            type="button"
            className="play-btn"
            onClick={() => setIsPlaying(!isPlaying)}
            aria-label={isPlaying ? "توقف پخش" : "شروع پخش ویدیو"}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
                <path d="M8 5v14l11-7L8 5Z" />
              </svg>
            )}
          </button>
          {!isPlaying && (
            <div className="absolute bottom-4 inset-x-0 text-center text-xs text-white/70 pointer-events-none">
              کلیک برای پخش تور تعاملی سیستم‌عامل ثروت توازن
            </div>
          )}
        </div>
        <div className="player-controls">
          <span className="time">{isPlaying ? "01:24 / 04:47" : "00:00 / 04:47"}</span>
          <div className="progress" role="progressbar" aria-valuenow={isPlaying ? 30 : 0} aria-valuemin={0} aria-valuemax={100} />
          <button type="button" className="icon-btn" aria-label="بی‌صدا یا با صدا">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
              <path d="M5 9v6h4l5 4V5L9 9H5Z" />
            </svg>
          </button>
          <button type="button" className="icon-btn" aria-label="حالت تمام‌صفحه">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* ───────────────── Gate Form ───────────────── */}
      <div className="gate" id="gate">
        <h2>ورود به فضای حساب کاربری توازن</h2>
        <p className="lede">پیشرفت شما خودکار و رمزنگاری‌شده ذخیره می‌شود.</p>
        <form
          className="gate-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
        >
          <div className="field">
            <label htmlFor="name">نام و نام خانوادگی یا عنوان حساب</label>
            <input id="name" type="text" required placeholder="مثلاً علیرضا رضایی" />
          </div>
          <div className="field tel">
            <label htmlFor="phone">شمارهٔ موبایل یا نام کاربری</label>
            <input id="phone" type="tel" required placeholder="09xxxxxxxxx" />
          </div>
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitted}>
            {submitted ? "در حال هدایت به حساب شما ✓" : "ثبت‌نام رایگان و مشاهده پورتفوی"}
          </button>
          <p className="microcopy">
            {submitted ? (
              <span className="text-[var(--online)] font-bold">
                حساب شما آماده شد! برای ورود به داشبورد کلیک کنید.
              </span>
            ) : (
              "بدون نیاز به کارت بانکی. داده‌های شما همیشه محرمانه و خصوصی است."
            )}
          </p>
        </form>
      </div>

      {/* ───────────────── Reassurance Note ───────────────── */}
      <p className="watch-note">
        در این سیستم‌عامل، تمام دارایی‌های واقعی، بدهی‌ها، وام‌ها و شاخص‌های تورم شخصی شما در یک دفتر کل اختصاصی جمع‌آوری می‌شوند.
        <br />
        <strong>با ایجاد حساب کاربری، اطلاعات مالی شما همیشه امن، مرتب و در دسترس باقی می‌ماند.</strong>
      </p>

      {/* ───────────────── Footer ───────────────── */}
      <footer className="site-footer" style={{ marginTop: "64px" }}>
        <div className="container">
          <Link href="/" className="brand" aria-label="توازن">
            <BrandMark framed size={28} />
            <span className="text-[0.95rem] font-bold">توازن</span>
          </Link>
          <p className="footer-note">© ۱۴۰۵ توازن — سیستم‌عامل ثروت شخصی</p>
        </div>
      </footer>
    </div>
  );
}
