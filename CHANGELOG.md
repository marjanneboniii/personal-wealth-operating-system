# تاریخچه‌ی تغییرات

تغییرات مهم توازن، از جدید به قدیم، به تفکیک ماه. هر مورد به Pull Request خودش لینک دارد. گزارش‌های ممیزی و رفع خطای هر دوره در [`docs/history/`](docs/history/README.md) است.

## مهر ۱۴۰۵

### قابلیت‌های تازه
- **هشتگ روی تراکنش:** برچسب آزاد (`#سفر`) هنگام ثبت، ویرایش بعد از ثبت، برچسب‌زدن گروهی، فیلتر و جمع کل هر برچسب به تومانِ روز ثبت. [#184][184]
- **نسبت اقساط به درآمد** در «بینش‌ها»، با هشدار بالای ۴۰٪. [#184][184]
- **مرکز یادآور:** زنگوله با تعداد موارد تازه در همه‌ی صفحه‌ها و صفحه‌ی `/notifications` برای اقساط، طلب‌ها، درآمدهای ماهانه و تراکنش‌های بررسی‌نشده. [#184][184]
- **دفتر چک:** چک صادره و دریافتی با سررسید، شناسه‌ی صیادی، برگشتی و ثبت اتمیکِ پاس شدن؛ اثر در پیش‌بینی نقدینگی و یادآورها. [#185][185]

### رفع خطا
- درآمد ماهانه‌ی تکرارشونده در پیش‌بینی نقدینگی به **دلار** حساب می‌شد (حقوق ۴۵ میلیونی = ۴۵۰ تومان)؛ حالا تومان است و migration شماره‌ی `0042` یادآورهای موجود را اصلاح می‌کند. [#185][185]
- `db:migrate` علت واقعی خطا را نشان می‌دهد، نه فقط `CREATE SCHEMA`. [#185][185]
- دکمه‌ی «ثبت تراکنش» در منوی کناری فشرده نمی‌شود؛ منو و نوار بالای موبایل مینیمال شد. [#185][185]

## شهریور ۱۴۰۵

### قابلیت‌های تازه
- **پیامک بانکی:** صندوق پیامک آیفون، بازبینی چندبانکی و تطبیق انتقال‌ها [#170][170]؛ اتصال پیامک به‌عنوان مرحله‌ی آخر راه‌اندازی [#171][171]؛ چند حساب بانکی در راه‌اندازی [#172][172] [#173][173]
- **تعهدات مالی:** طلب در کنار بدهی، زمان‌بندی آزاد اقساط و پرداخت بخشی [#142][142]؛ فریز تومانِ قسط و snapshot دلاری هنگام پرداخت [#105][105]؛ دسته‌ی جدای «پرداخت اقساط» که دیگر هزینه حساب نمی‌شود [#125][125]
- **دارایی و بازار:** سهام بورسی و کاتالوگ والکس با قیمت تومانی و تتری [#144][144]؛ سهام آمریکا، شاخص، کامودیتی و «نمای بازار» [#148][148] [#150][150]؛ محل نگهداری هر رمزارز و استیبل‌کوین [#154][154]؛ ثبت خودرو و ملک در راه‌اندازی اولیه
- **ردیاب تورم شخصی** به‌عنوان ماژول مستقل [#116][116] [#117][117]
- **درآمد:** انتخابگر تازه‌ی منبع درآمد و راه‌اندازی اجباری [#155][155] [#156][156]
- **حذف حساب** با کادر تأیید و حفظ تغییرناپذیری دفترکل [#179][179]
- **ورود تاریخ فقط به شمسی** در کل برنامه [#121][121]

### امنیت و زیرساخت
- مهاجرت احراز هویت و جداسازی کاربران به Supabase [#131][131] [#132][132] [#178][178]
- مقیاس‌پذیری: اندازه‌ی قابل‌تنظیم pool، محدودیت نرخ با Redis، کش وضعیت کاربران [#123][123]
- سبز شدن کامل مجموعه‌ی تست‌ها [#180][180] و بازنشسته‌شدن کد بلااستفاده [#182][182]
- CAPTCHA و ورود دومرحله‌ای اضافه [#96][96]–[#103][103] و سپس کامل حذف شد [#104][104]

### طراحی
- مهاجرت به سیستم طراحی رسمی [#149][149]؛ بازطراحی دارایی‌ها، تعهدات، نمای کلی، پول و راه‌اندازی [#151][151]
- بازطراحی مینیمال فرم‌ها: هزینه، انتقال، خرید و فروش، بازپرداخت، اقساط و املاک [#157][157]–[#163][163] [#165][165]
- لندینگ تیره‌ی تازه و اصلاحات PWA آیفون [#133][133] [#134][134] [#139][139] [#140][140] [#166][166]–[#169][169]
- طرح «آبی آسمانی» [#126][126]–[#128][128] امتحان و برگردانده شد [#129][129] [#130][130]

### رفع خطا
- **جریان نقدی و گزارش‌ها:** فریز مبالغ تومانی در برابر تغییر نرخ و بستن نشت بین کاربران [#108][108]؛ کارمزد معامله در خروجی ماه [#176][176] [#177][177]؛ پیش‌نمایش خرید و فروش با کارمزد [#174][174] [#175][175]
- **دفترکل و بدهی:** «مانده کل بدهی» از روی برنامه‌ی اقساط [#107][107] [#106][106]؛ حساب‌های سیستمی هر کاربر، DCA چندارزی [#111][111]؛ سود و زیان تحقق‌یافته و تفکیک بدهی [#112][112] [#113][113]؛ ارزش‌گذاری تومانی دارایی‌های تومانی [#110][110]
- **املاک:** تاریخچه‌ی ارزش‌گذاری تغییرناپذیر و تحلیل رشد دلاری/تومانی [#85][85]؛ شناسه‌ی کوتاه عددی [#77][77] [#84][84]؛ پاک‌سازی داده‌های یتیم در گزارش‌ها [#86][86]–[#95][95]؛ بازگشت «املاک من» [#114][114] [#115][115]
- **نمایش مبلغ و موبایل:** علامت منفی قبل از رقم [#137][137] [#138][138]؛ چیدمان جدول‌ها و اقساط در موبایل [#118][118]–[#120][120] [#124][124] [#109][109] [#135][135] [#136][136]؛ ثبات مبالغ تومانی بدهی و برنامه با تغییر نرخ [#79][79]–[#82][82]

## مرداد ۱۴۰۵

### پایه‌ی سیستم
- نسخه‌ی پایه و فازهای تحلیل ثروت، موتور ارز و لایه‌ی داده‌ی بازار [#1][1]–[#3][3]؛ نسخه‌ی گسترده با موتور سناریو [#4][4] [#5][5]؛ هسته‌ی سبک با پیش‌نمایش پیش از ثبت [#6][6]
- سیستم طراحی «Calm Ledger»، موتور یکپارچگی و PWA [#11][11]
- **دسته‌بندی سلسله‌مراتبی هزینه‌ها** [#26][26]
- **دارایی واقعی:** خودرو با کاتالوگ و ارزش‌گذاری تغییرناپذیر [#20][20]؛ املاک با حسابداری دوبل و تاریخ تملک واقعی [#21][21]؛ فضای ثبت دارایی واقعی و کالا [#16][16]
- **حساب‌های پول:** ثبت با موجودی اولیه [#36][36]؛ واحد هر حساب و اسناد FX [#41][41]–[#43][43]؛ اصلاحات راه‌اندازی [#39][39] [#40][40] [#44][44]–[#50][50]

### امنیت
- احراز هویت، نرخ ارز هر کاربر و سخت‌سازی موبایل [#12][12]؛ سخت‌سازی مرحله‌ی ۱ تا ۷ و ایزولاسیون چندکاربره [#14][14] [#18][18] [#19][19] [#22][22]؛ آماده‌سازی production و ابزار migration [#27][27] [#29][29]
- جداسازی کاربران، مرجع نرخ ارز و مدل تومانی بدهی [#59][59]

### قیمت‌گذاری
- قیمت‌گذاری ایزوله به‌جای داده‌ی بازار قدیمی [#23][23]؛ کاتالوگ کامل CoinGecko [#24][24]؛ آخرین قیمت معتبر هنگام قطعی یا محدودیت نرخ [#51][51]–[#53][53]

### برند و تجربه‌ی کاربری
- نام برند: «تراز» [#25][25] ← «وِزان» [#34][34] ← «توازن» [#55][55] [#56][56]؛ لندینگ عمومی و نصب PWA [#30][30]–[#33][33] [#54][54]
- **تومان به‌عنوان ارز اصلی** نمایش و دلار به‌عنوان معادل [#58][58] [#65][65] [#69][69] [#70][70] [#72][72]؛ نمایش فارسی مبالغ [#9][9] [#45][45] [#46][46]
- دستورالعمل جامع سیستم: ورود اجباری، تغییرناپذیری تومان، حالت حرفه‌ای [#67][67]

[1]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/1
[3]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/3
[4]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/4
[5]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/5
[6]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/6
[9]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/9
[11]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/11
[12]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/12
[14]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/14
[16]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/16
[18]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/18
[19]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/19
[20]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/20
[21]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/21
[22]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/22
[23]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/23
[24]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/24
[25]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/25
[26]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/26
[27]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/27
[29]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/29
[30]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/30
[33]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/33
[34]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/34
[36]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/36
[39]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/39
[40]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/40
[41]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/41
[43]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/43
[44]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/44
[45]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/45
[46]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/46
[50]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/50
[51]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/51
[53]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/53
[54]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/54
[55]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/55
[56]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/56
[58]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/58
[59]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/59
[65]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/65
[67]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/67
[69]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/69
[70]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/70
[72]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/72
[77]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/77
[79]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/79
[82]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/82
[84]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/84
[85]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/85
[86]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/86
[95]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/95
[96]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/96
[103]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/103
[104]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/104
[105]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/105
[106]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/106
[107]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/107
[108]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/108
[109]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/109
[110]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/110
[111]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/111
[112]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/112
[113]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/113
[114]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/114
[115]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/115
[116]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/116
[117]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/117
[118]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/118
[120]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/120
[121]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/121
[123]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/123
[124]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/124
[125]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/125
[126]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/126
[128]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/128
[129]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/129
[130]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/130
[131]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/131
[132]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/132
[133]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/133
[134]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/134
[135]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/135
[136]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/136
[137]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/137
[138]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/138
[139]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/139
[140]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/140
[142]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/142
[144]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/144
[148]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/148
[149]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/149
[150]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/150
[151]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/151
[154]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/154
[155]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/155
[156]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/156
[157]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/157
[163]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/163
[165]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/165
[166]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/166
[169]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/169
[170]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/170
[171]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/171
[172]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/172
[173]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/173
[174]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/174
[175]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/175
[176]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/176
[177]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/177
[178]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/178
[179]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/179
[180]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/180
[182]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/182
[184]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/184
[185]: https://github.com/marjanneboniii/personal-wealth-operating-system/pull/185
