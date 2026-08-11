export const fa = {
  setup: {
    title: "راه‌اندازی اولیه سیستم‌عامل ثروت شخصی",
    subtitle: "پیکربندی ارز محاسباتی، حساب‌های مالی و ثبت موجودی اولیه بدون داده نمونه",
    step1Title: "مرحله ۱: تنظیمات ارز و تقویم",
    step1Desc: "ارز پایه برای محاسبات دفترکل و ارز نمایشگر در رابط کاربری را انتخاب کنید.",
    accountingCurrencyLabel: "ارز پایه محاسباتی دفترکل (Accounting Currency)",
    accountingCurrencyHelp: "ارزی که تمامی محاسبات تراز، ارزش خالص و دفترکل با آن ثبت می‌شوند.",
    displayCurrencyLabel: "ارز نمایش در گزارش‌ها (Display Currency)",
    displayCurrencyHelp: "ارز ترجیحی برای نمایش مقادیر در رابط کاربری. محاسبات دفترکل را تغییر نمی‌دهد.",
    dateCalendarLabel: "تقویم نمایش تاریخ",
    dateCalendarJalali: "هجری شمسی (جلالی)",
    dateCalendarGregorian: "میلادی (Gregorian)",
    userNameLabel: "نام کاربر یا مالکان خانواده",
    userNamePlaceholder: "مثلاً: علی و سارا",

    step2Title: "مرحله ۲: ایجاد نمودار حساب‌ها (Chart of Accounts)",
    step2Desc: "حساب‌های اصلی مالی خود را برای نگهداری دارایی‌ها و بدهی‌ها مشخص کنید.",
    mainBankAccount: "حساب بانکی اصلی",
    cashWallet: "صندوق نقد / کیف پول نقد",
    cryptoWallet: "کیف پول رمزارز (سرد/داغ)",
    goldHolding: "حساب طلا و مسکوکات",
    loanLiability: "وام / بدهی شخصی",

    step3Title: "مرحله ۳: ثبت موجودی اولیه (Opening Balances)",
    step3Desc: "ثروت موجود خود را وارد کنید. موجودی اولیه طبق قواعد حسابداری دوطرفه در دفترکل ثبت می‌شود.",
    openingBalanceHelp: "موجودی اولیه با سند افتتاحیه متوازن در حساب سرمایه افتتاحیه (Opening Balance Equity) ثبت می‌شود.",
    cashAmount: "موجودی نقد و بانک",
    cryptoAmount: "مقدار رمزارز (مثلاً ETH)",
    goldAmount: "مقدار طلا (گرم)",

    step4Title: "مرحله ۴: پیش‌نمایش و تایید",
    step4Desc: "خلاصه پیکربندی و سند افتتاحیه قبل از ثبت نهایی",
    previewTitle: "پیش‌نمایش سند افتتاحیه دفترکل",
    debitLabel: "بدهکار (ورود دارایی)",
    creditLabel: "بستانکار (سرمایه افتتاحیه)",
    balancedCheck: "تراز سند افتتاحیه: متوازن ✅",

    submitBtn: "تکمیل راه‌اندازی و ورود به سیستم",
    submitting: "در حال ثبت موجودی اولیه…",
    completedMessage: "راه‌اندازی سیستم‌عامل ثروت شخصی با موفقیت انجام شد.",
    alreadyCompleted: "راه‌اندازی اولیه قبلاً انجام شده است.",
  },
  common: {
    back: "قبلی",
    next: "بعدی",
    save: "ذخیره",
    error: "خطا",
    success: "موفقیت",
  },
};

export type Translations = typeof fa;
