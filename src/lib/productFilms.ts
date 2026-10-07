/** Fictional public examples. No user data or account services are imported. */
export const PRODUCT_FILM_CHAPTERS = [
  { at: 0, duration: 4, title: "شروع راه‌اندازی", caption: "توازن را باز کنید و راه‌اندازی اولیه را شروع کنید.", scene: "start" },
  { at: 4, duration: 4, title: "حساب‌ها", caption: "موجودی حساب روزمره را وارد کنید.", scene: "accounts" },
  { at: 8, duration: 4, title: "دارایی‌ها", caption: "طلا، صندوق و رمزارز را کنار حساب‌ها ثبت کنید.", scene: "holdings" },
  { at: 12, duration: 4, title: "وام و بدهی", caption: "ماندهٔ بدهی و اقساط باقی‌مانده را اضافه کنید.", scene: "debt" },
  { at: 16, duration: 3, title: "مرور و تأیید", caption: "اطلاعات را مرور کنید و وارد توازن شوید.", scene: "review" },
  { at: 19, duration: 3, title: "نمای کلی", caption: "دارایی منهای بدهی؛ نقطهٔ شروع شما روشن است.", scene: "overview" },
  { at: 22, duration: 5, title: "خرج و بودجه", caption: "درآمد، خرج ماه و فاصله تا سقف بودجه را ببینید.", scene: "budget" },
  { at: 27, duration: 5, title: "ثبت پرداخت قسط", caption: "مبلغ و حساب پرداخت را انتخاب و پرداخت انجام‌شده را ثبت کنید.", scene: "payment" },
  { at: 32, duration: 4, title: "پس از پرداخت", caption: "حساب و بدهی هر دو ۵ میلیون کم شدند؛ ارزش خالص ثابت ماند.", scene: "paid" },
  { at: 36, duration: 4, title: "سبد سرمایه‌گذاری", caption: "ارزش سبد، بهای خرید و سود تحقق‌نیافته را یک‌جا ببینید.", scene: "portfolio" },
] as const;

export const PRODUCT_PREVIEW_CHAPTERS = [
  { at: 0, duration: 4, title: "تصویر مالی شما", caption: "۱۲۵ میلیون تومان ارزش خالص؛ حساب‌ها، دارایی‌ها و بدهی‌ها یک‌جا.", scene: "overview" },
  { at: 4, duration: 4, title: "خرج ماه زیر نظر شما", caption: "برای خرید ماهانه، ۲ میلیون تومان تا سقف بودجه مانده است.", scene: "budget" },
  { at: 8, duration: 4, title: "ثبت پرداخت قسط", caption: "پرداخت انجام‌شدهٔ قسط ۵ میلیونی را ثبت کنید.", scene: "payment" },
  { at: 12, duration: 4, title: "نتیجهٔ ثبت پرداخت", caption: "موجودی حساب ۳۰ میلیون و ماندهٔ بدهی ۵۰ میلیون تومان شد.", scene: "paid" },
  { at: 16, duration: 4, title: "سرمایه‌تان در یک نگاه", caption: "سبد ۱۴۵ میلیونی، با ۱۵ میلیون تومان سود تحقق‌نیافتهٔ نمونه.", scene: "portfolio" },
] as const;

export const PRODUCT_FILM_TOPICS = [
  { title: "نمای کلی", description: "بدانید چه دارید، چقدر بدهکارید و تا سقف بودجه چقدر مانده.", previewAt: 0, icon: "wallet" },
  { title: "قسط", description: "قسط ثبت شد؛ موجودی حساب و ماندهٔ بدهی را همان‌جا ببینید.", previewAt: 8, icon: "installments" },
  { title: "سرمایه‌گذاری", description: "ببینید سرمایه‌تان کجا پخش شده و نسبت به بهای خرید چه تغییری کرده.", previewAt: 16, icon: "portfolio" },
] as const;

export const PRODUCT_FILM_DURATION = 40;
export const PRODUCT_PREVIEW_DURATION = 20;
export type ProductFilmVariant = "pwa" | "web";
export const PRODUCT_FILMS = {
  pwa: { label: "گوشی", width: 900, height: 1200, src: "/videos/tavazon/pwa.mp4", poster: "/videos/tavazon/pwa-poster.webp" },
  web: { label: "وب", width: 1280, height: 800, src: "/videos/tavazon/web.mp4", poster: "/videos/tavazon/web-poster.webp" },
} as const;
export const PRODUCT_PREVIEW = { label: "نمایش کوتاه توازن", width: 900, height: 900, src: "/videos/tavazon/preview.mp4", poster: "/videos/tavazon/preview-poster.webp" } as const;
export type ProductFilmScene = typeof PRODUCT_FILM_CHAPTERS[number]["scene"];
export type ProductFilmKind = ProductFilmVariant | "preview";
