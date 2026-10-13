/**
 * Real-estate master data — the INITIAL catalogue (dynamic afterwards: rows are
 * only ever added when missing, never renamed or reactivated).
 *
 * Every city ends with «سایر مناطق» so a user whose area is not listed can
 * still register. Codes are stable identifiers: never change an existing one.
 */

type Seed = { nameFa: string; nameEn: string; code: string };
export type CitySeed = Seed & { neighborhoods: Seed[] };

/** «نام فارسی|English Name» pairs → seeds with a stable code from the English name. */
function hoods(list: string): Seed[] {
  const rows = list.split("،").map((s) => s.trim()).filter(Boolean).map((pair) => {
    const [nameFa, nameEn] = pair.split("|").map((s) => s.trim());
    return { nameFa, nameEn, code: nameEn.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16) };
  });
  return [...rows, OTHER_AREAS];
}

const OTHER_AREAS: Seed = { nameFa: "سایر مناطق", nameEn: "Other Areas", code: "OTHER" };

/** Legacy Ahvaz neighbourhoods — their codes predate this catalogue and are kept as-is. */
export const NEIGHBORHOODS_SEED: Seed[] = [
  { nameFa: "گلستان", nameEn: "Golestan", code: "GOL" },
  { nameFa: "سعدی", nameEn: "Saadi", code: "SAD" },
  { nameFa: "فرهنگ شهر", nameEn: "Farhang Shahr", code: "FAR" },
  { nameFa: "باغ شیخ", nameEn: "Bagh Sheikh", code: "BAG" },
  { nameFa: "امانیه", nameEn: "Amanieh", code: "AMA" },
  { nameFa: "کوروش", nameEn: "Kourosh", code: "KUR" },
  { nameFa: "کمپلو شمالی", nameEn: "Kompilo North", code: "KNO" },
  { nameFa: "کیانپارس شرقی", nameEn: "Kianpars East", code: "KPE" },
  { nameFa: "کیان پارس غربی", nameEn: "Kianpars West", code: "KPW" },
  { nameFa: "شهرک دانشگاه", nameEn: "Shahrak Daneshgah", code: "SDU" },
  { nameFa: "زیتون کارمندی", nameEn: "Zeytoon Karmandi", code: "ZKA" },
  { nameFa: "کیان آباد شرقی", nameEn: "Kianabad East", code: "KAE" },
  { nameFa: "کیان آباد غربی", nameEn: "Kianabad West", code: "KAW" },
  { nameFa: "پاداد", nameEn: "Padad", code: "PAD" },
  { nameFa: "آریا شهر", nameEn: "Arya Shahr", code: "ARS" },
  { nameFa: "مهر شهر", nameEn: "Mehr Shahr", code: "MHR" },
];

export const CITY_CATALOG_SEED: CitySeed[] = [
  {
    nameFa: "اهواز", nameEn: "Ahvaz", code: "AHZ",
    neighborhoods: [
      ...NEIGHBORHOODS_SEED,
      ...hoods("زیتون ارتشی|Zeytoon Arteshi، کیانشهر|Kianshahr، نادری|Naderi، کوی ملت|Kooye Mellat، کوی مهدیس|Kooye Mahdis، حصیرآباد|Hasirabad، کوت عبدالله|Kut Abdollah، منبع آب|Manba Ab، کوی علوی|Kooye Alavi"),
    ],
  },
  {
    nameFa: "تهران", nameEn: "Tehran", code: "THR",
    neighborhoods: hoods("تجریش|Tajrish، نیاوران|Niavaran، الهیه|Elahieh، زعفرانیه|Zafaranieh، فرمانیه|Farmanieh، قیطریه|Gheytarieh، اقدسیه|Aghdasieh، دروس|Darrous، ولنجک|Velenjak، سعادت‌آباد|Saadat Abad، شهرک غرب|Shahrak Gharb، پونک|Pounak، جردن|Jordan، ونک|Vanak، یوسف‌آباد|Yousef Abad، امیرآباد|Amirabad، گیشا|Gisha، ستارخان|Sattarkhan، صادقیه|Sadeghieh، جنت‌آباد|Jannat Abad، شهران|Shahran، چیتگر|Chitgar، تهرانپارس|Tehranpars، نارمک|Narmak، پیروزی|Pirouzi، شمیران نو|Shemiran No، پاسداران|Pasdaran، هروی|Heravi، مرزداران|Marzdaran، اکباتان|Ekbatan، آزادی|Azadi، انقلاب|Enghelab، مرکز شهر|City Center، نازی‌آباد|Naziabad، خانی‌آباد|Khaniabad، افسریه|Afsarieh، شهرری|Shahr Rey، تهرانسر|Tehransar، پرند|Parand، پردیس|Pardis"),
  },
  {
    nameFa: "کرج", nameEn: "Karaj", code: "KRJ",
    neighborhoods: hoods("عظیمیه|Azimieh، گوهردشت|Gohardasht، مهرشهر|Mehrshahr، جهانشهر|Jahanshahr، فردیس|Fardis، باغستان|Baghestan، حصارک|Hesarak، کرج نو|Karaj No، شاهین‌ویلا|Shahin Villa، کمالشهر|Kamalshahr، اسلام‌آباد|Eslamabad، مهرویلا|Mehrvilla، هفت‌تیر|Haft-e Tir"),
  },
  {
    nameFa: "مشهد", nameEn: "Mashhad", code: "MHD",
    neighborhoods: hoods("احمدآباد|Ahmadabad، سجاد|Sajad، هاشمیه|Hashemieh، وکیل‌آباد|Vakilabad، فلسطین|Felestin، کوهسنگی|Kooh Sangi، قاسم‌آباد|Ghasemabad، الهیه|Elahieh MHD، بلوار پیروزی|Pirouzi Blvd، رضاشهر|Rezashahr، آزادشهر|Azadshahr، طبرسی|Tabarsi، سیدی|Seyyedi، طلاب|Tollab، بلوار توس|Toos Blvd، اطراف حرم|Haram Area، مهرآباد|Mehrabad MHD، شهرک شهید رجایی|Shahid Rajaei"),
  },
  {
    nameFa: "اصفهان", nameEn: "Isfahan", code: "ISF",
    neighborhoods: hoods("جلفا|Jolfa، مرداویج|Mardavij، چهارباغ|Chaharbagh، شیخ صدوق|Sheikh Sadough، خیابان نظر|Nazar St، سپاهان‌شهر|Sepahanshahr، آینه‌خانه|Ayeneh Khaneh، هزارجریب|Hezar Jarib، خانه اصفهان|Khaneh Isfahan، ملک‌شهر|Malekshahr، بهارستان|Baharestan، زینبیه|Zeinabieh، دولت‌آباد|Dolatabad، شهرک امیریه|Amirieh، جی|Jey، سعادت‌آباد|Saadat Abad ISF"),
  },
  {
    nameFa: "شیراز", nameEn: "Shiraz", code: "SYZ",
    neighborhoods: hoods("قصردشت|Ghasrodasht، معالی‌آباد|Maaliabad، ارم|Eram، زرهی|Zerehi، فرهنگ‌شهر|Farhangshahr، ستارخان|Sattarkhan SYZ، شهرک گلستان|Golestan SYZ، صدرا|Sadra، پودنک|Poudenak، عفیف‌آباد|Afifabad، زند|Zand، مرکز شهر|City Center SYZ، معالی‌آباد شمالی|Maaliabad North، سینما سعدی|Saadi Cinema، بلوار چمران|Chamran Blvd"),
  },
  {
    nameFa: "تبریز", nameEn: "Tabriz", code: "TBZ",
    neighborhoods: hoods("ولیعصر|Valiasr، رشدیه|Roshdieh، باغمیشه|Baghmisheh، ائل‌گلی|Elgoli، زعفرانیه|Zafaranieh TBZ، آبرسان|Abresan، کوی فرشته|Kooye Fereshteh، شهرک باغمیشه|Baghmisheh Town، منظریه|Manzarieh، مارالان|Maralan، ششگلان|Sheshgelan، کوی ولیعصر|Kooye Valiasr، یاغچیان|Yaghchian"),
  },
  {
    nameFa: "قم", nameEn: "Qom", code: "QOM",
    neighborhoods: hoods("پردیسان|Pardisan، صفاشهر|Safashahr، سالاریه|Salarieh، زنبیل‌آباد|Zanbilabad، نیروگاه|Niroogah، بلوار امین|Amin Blvd، جمهوری|Jomhouri، شهرک قدس|Ghods Town، عمار یاسر|Ammar Yaser، اطراف حرم|Haram Area QOM"),
  },
  {
    nameFa: "رشت", nameEn: "Rasht", code: "RST",
    neighborhoods: hoods("گلسار|Golsar، منظریه|Manzarieh RST، معلم|Moallem، بلوار گیلان|Gilan Blvd، پل عراق|Pol-e Eraq، حمیدیان|Hamidian، استادسرا|Ostadsara، لاکانی|Lakani، کوی امام|Kooye Emam، شهرک بعثت|Besat Town"),
  },
  {
    nameFa: "ارومیه", nameEn: "Urmia", code: "URM",
    neighborhoods: hoods("شهرک ولیعصر|Valiasr URM، خیابان مدرس|Modarres St، دانشکده|Daneshkadeh، کشاورز|Keshavarz، شهرک امام|Emam Town، خیام|Khayyam، بند|Band، شهرک فرهنگیان|Farhangian Town"),
  },
  {
    nameFa: "کرمانشاه", nameEn: "Kermanshah", code: "KSH",
    neighborhoods: hoods("الهیه|Elahieh KSH، فرهنگیان|Farhangian، کسری|Kasra، مسکن|Maskan، شهرک ظفر|Zafar Town، دولت‌آباد|Dolatabad KSH، طاق‌بستان|Taq-e Bostan، بلوار شهید بهشتی|Beheshti Blvd، نوبهار|Noubahar"),
  },
  {
    nameFa: "کرمان", nameEn: "Kerman", code: "KRN",
    neighborhoods: hoods("شهرک مطهری|Motahari Town، بلوار جمهوری|Jomhouri Blvd، شهرک باهنر|Bahonar Town، خواجو|Khajoo، امیرکبیر|Amirkabir، شهرک الهیه|Elahieh KRN، فردوسی|Ferdowsi، شهرک صنعتی|Industrial Town"),
  },
  {
    nameFa: "همدان", nameEn: "Hamedan", code: "HMD",
    neighborhoods: hoods("مدرس|Modarres HMD، خضر|Khezr، اعتمادیه|Etemadieh، سعیدیه|Saeedieh، شهرک فرهنگیان|Farhangian HMD، کوی رسالت|Resalat، میدان امام|Emam Square، مزدقینه|Mazdaghineh"),
  },
  {
    nameFa: "یزد", nameEn: "Yazd", code: "YZD",
    neighborhoods: hoods("صفاییه|Safaieh، بلوار جمهوری|Jomhouri YZD، آزادشهر|Azadshahr YZD، شهرک دانشگاه|University Town، فهادان|Fahadan، امام‌شهر|Emamshahr، اکرمیه|Akramieh، بافت تاریخی|Historic Core"),
  },
  {
    nameFa: "اراک", nameEn: "Arak", code: "ARK",
    neighborhoods: hoods("شهرک قدس|Ghods ARK، باغ ملی|Bagh-e Melli، کوی مدرس|Modarres ARK، شهرک شهید بهشتی|Beheshti Town، اکبرآباد|Akbarabad، کرهرود|Karahrood، ملک‌آباد|Malekabad"),
  },
  {
    nameFa: "اردبیل", nameEn: "Ardabil", code: "ADU",
    neighborhoods: hoods("کارشناسان|Karshenasan، شهرک ولیعصر|Valiasr ADU، کوی فرهنگیان|Farhangian ADU، سبلان|Sabalan، شهرک کوثر|Kowsar، مرکز شهر|City Center ADU"),
  },
  {
    nameFa: "قزوین", nameEn: "Qazvin", code: "QZV",
    neighborhoods: hoods("نوروزیان|Nowruzian، مینودر|Minoodar، پونک|Pounak QZV، شهرک بهشتی|Beheshti QZV، فلسطین|Felestin QZV، بلوار نخبگان|Nokhbegan Blvd، مرکز شهر|City Center QZV"),
  },
  {
    nameFa: "زنجان", nameEn: "Zanjan", code: "ZNJ",
    neighborhoods: hoods("کوی کارمندان|Karmandan، شهرک کارمندان|Karmandan Town، اسلام‌آباد|Eslamabad ZNJ، شهرک الهیه|Elahieh ZNJ، کوی فرهنگ|Farhang، مرکز شهر|City Center ZNJ"),
  },
  {
    nameFa: "ساری", nameEn: "Sari", code: "SRY",
    neighborhoods: hoods("خیابان فرهنگ|Farhang St، بلوار طالقانی|Taleghani Blvd، میدان امام|Emam Sq SRY، کوی کارگر|Kooye Kargar، شهرک میرداماد|Mirdamad Town، جاده دریا|Darya Road"),
  },
  {
    nameFa: "گرگان", nameEn: "Gorgan", code: "GRG",
    neighborhoods: hoods("گلشهر|Golshahr، ناهارخوران|Naharkhoran، بلوار جرجان|Jorjan Blvd، شهرک قابوس|Qaboos Town، عدالت|Edalat، مرکز شهر|City Center GRG"),
  },
  {
    nameFa: "خرم‌آباد", nameEn: "Khorramabad", code: "KHD",
    neighborhoods: hoods("شهرک امام|Emam KHD، کوی فرهنگیان|Farhangian KHD، دره‌گرم|Darreh Garm، مطهری|Motahari KHD، مرکز شهر|City Center KHD"),
  },
  {
    nameFa: "سنندج", nameEn: "Sanandaj", code: "SDG",
    neighborhoods: hoods("شهرک بهاران|Baharan، شهرک سعدی|Saadi SDG، کوی کشاورز|Keshavarz SDG، فرجه|Farajeh، شهرک الهیه|Elahieh SDG، مرکز شهر|City Center SDG"),
  },
  {
    nameFa: "بندرعباس", nameEn: "Bandar Abbas", code: "BND",
    neighborhoods: hoods("گلشهر|Golshahr BND، شهرک پردیس|Pardis BND، کوی نیروی دریایی|Navy Quarter، دولت|Dolat، رسالت|Resalat BND، شهرک توحید|Towhid، مرکز شهر|City Center BND"),
  },
  {
    nameFa: "بوشهر", nameEn: "Bushehr", code: "BUZ",
    neighborhoods: hoods("بهمنی|Bahmani، ریشهر|Rishahr، سنگی|Sangi، شهرک جفره|Jofreh، بافت قدیم|Old Town BUZ، مرکز شهر|City Center BUZ"),
  },
  {
    nameFa: "زاهدان", nameEn: "Zahedan", code: "ZAH",
    neighborhoods: hoods("زیباشهر|Zibashahr، شهرک بهشتی|Beheshti ZAH، کوی دانشگاه|University Quarter ZAH، شیرآباد|Shirabad، مرکز شهر|City Center ZAH"),
  },
  {
    nameFa: "بیرجند", nameEn: "Birjand", code: "XBJ",
    neighborhoods: hoods("شهرک مهرشهر|Mehrshahr XBJ، کوی معلم|Moallem XBJ، شهرک شهید مطهری|Motahari XBJ، مرکز شهر|City Center XBJ"),
  },
  {
    nameFa: "بجنورد", nameEn: "Bojnurd", code: "BJB",
    neighborhoods: hoods("شهرک امام|Emam BJB، شهرک فرهنگیان|Farhangian BJB، مرکز شهر|City Center BJB"),
  },
  {
    nameFa: "سمنان", nameEn: "Semnan", code: "SNX",
    neighborhoods: hoods("شهرک گلستان|Golestan SNX، کوی فرهنگیان|Farhangian SNX، شهرک مسکن|Maskan SNX، مرکز شهر|City Center SNX"),
  },
  {
    nameFa: "ایلام", nameEn: "Ilam", code: "IIL",
    neighborhoods: hoods("شهرک بانک|Bank Town، کوی فرهنگیان|Farhangian IIL، مرکز شهر|City Center IIL"),
  },
  {
    nameFa: "یاسوج", nameEn: "Yasuj", code: "YES",
    neighborhoods: hoods("شهرک فرهنگیان|Farhangian YES، کوی شهدا|Shohada YES، مرکز شهر|City Center YES"),
  },
  {
    nameFa: "شهرکرد", nameEn: "Shahrekord", code: "CQD",
    neighborhoods: hoods("شهرک فرهنگیان|Farhangian CQD، کوی ملاصدرا|Molla Sadra، مرکز شهر|City Center CQD"),
  },
];

export const CITIES_SEED: Seed[] = CITY_CATALOG_SEED.map(({ nameFa, nameEn, code }) => ({ nameFa, nameEn, code }));

export const PROPERTY_TYPES_SEED: { nameFa: string; nameEn: string; code: string }[] = [
  { nameFa: "آپارتمان", nameEn: "Apartment", code: "APT" },
  { nameFa: "خانه ویلایی", nameEn: "Villa House", code: "HOU" },
  { nameFa: "زمین", nameEn: "Land", code: "LND" },
  { nameFa: "مغازه / واحد تجاری", nameEn: "Shop / Commercial Unit", code: "SHO" },
  { nameFa: "دفتر کار", nameEn: "Office", code: "OFF" },
  { nameFa: "ویلا", nameEn: "Villa", code: "VIL" },
  { nameFa: "باغ", nameEn: "Garden", code: "GAR" },
  { nameFa: "ملک اداری", nameEn: "Administrative Property", code: "ADM" },
  { nameFa: "ملک صنعتی", nameEn: "Industrial Property", code: "IND" },
  { nameFa: "انبار", nameEn: "Warehouse", code: "WAR" },
  { nameFa: "پارکینگ", nameEn: "Parking", code: "PRK" },
  { nameFa: "سایر", nameEn: "Other", code: "OTH" },
];
