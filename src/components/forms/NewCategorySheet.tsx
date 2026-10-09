"use client";

/**
 * «دسته جدید» — the one place the transaction form asks for a name.
 *
 * A dashed «+ دسته جدید» tile at the end of a group's tiles opens this sheet:
 *
 *   • the group it goes into, with the group's own icon and colour;
 *   • a live preview of the tile exactly as it will appear in the grid;
 *   • ready-made names for that group (one tap fills the field), so most
 *     people never type — only names the group does not have yet are offered;
 *   • a duplicate check: a name the group already has is offered as
 *     «انتخاب همان» instead of being created twice;
 *   • save → the category is created, selected and the sheet closes.
 *
 * Writes through `createCategoryAction` (expense and income trees alike); the
 * caller adds the returned leaf to its list.
 */
import { useState, useTransition } from "react";
import { createCategoryAction } from "@/app/actions";
import Icon, { type IconName } from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import { faCount } from "@/lib/format";
import type { CategoryGroupOption } from "./TransactionForm";

const MAX = 40;

/** Common names per group code — offered only when the group lacks them. */
const SUGGESTIONS: Record<string, string[]> = {
  HSG: ["شارژ ساختمان", "تعمیرات منزل", "لوازم خانه", "اجاره‌بها", "نظافت منزل"],
  TRN: ["کارواش", "پارکینگ", "عوارض آزادراه", "تاکسی اینترنتی", "بنزین"],
  FOD: ["نان", "میوه و تره‌بار", "رستوران", "کافه", "سفارش آنلاین غذا"],
  HLT: ["دندان‌پزشکی", "عینک", "آزمایش", "فیزیوتراپی", "داروخانه"],
  HYG: ["آرایشگاه", "لوازم آرایشی", "باشگاه ورزشی", "ماساژ"],
  CLT: ["کفش", "لباس کودک", "اکسسوری", "خشک‌شویی"],
  ENT: ["سینما", "سفر", "کنسرت", "بازی", "کتاب"],
  COM: ["اینترنت خانگی", "شارژ موبایل", "اشتراک فیلم", "اشتراک موسیقی", "سرویس ابری"],
  PUR: ["لوازم دیجیتال", "هدیه", "لوازم تحریر"],
  FAM: ["مهد کودک", "پول توجیبی", "کمک به والدین", "حیوان خانگی"],
  INS: ["بیمه بدنه", "بیمه عمر", "بیمه تکمیلی"],
  EDU: ["دوره آنلاین", "کلاس زبان", "کتاب آموزشی", "شهریه"],
  WRK: ["ابزار کار", "نرم‌افزار", "هزینه رفت‌وآمد کاری"],
  TAX: ["عوارض شهرداری", "هزینه دفترخانه", "جریمه"],
  SOC: ["نذری", "کمک خیریه", "هدیه عروسی"],
  MSC: ["کارمزد بانکی", "هزینه پیش‌بینی‌نشده"],
  "INC-SAL": ["حق مأموریت", "حق شیفت"],
  "INC-BIZ": ["فروش آنلاین", "تبلیغات", "تعمیرات"],
  "INC-INV": ["سود طلا", "سود صندوق سهامی"],
  "INC-PEN": ["مستمری فرزند"],
  "INC-SUP": ["کمک‌هزینه ازدواج", "وام قرض‌الحسنه فامیلی"],
  "INC-OTH": ["عیدی فامیلی", "بازپرداخت هزینه"],
};

const norm = (s: string) => s.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌\s]+/g, " ").trim().toLowerCase();

export function NewCategoryTile({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="txr-tile txr-tile-new" onClick={onClick}>
      <span className="txr-tile-icon" aria-hidden="true">
        <Icon name="plus" size={18} />
      </span>
      <span className="txr-tile-label">دسته جدید</span>
    </button>
  );
}

export default function NewCategorySheet({
  open,
  onClose,
  group,
  look,
  noun = "دسته",
  onCreated,
  onPickExisting,
}: {
  open: boolean;
  onClose: () => void;
  group: CategoryGroupOption;
  look: { icon: IconName; color: string };
  /** «دسته» for expenses, «منبع» for income. */
  noun?: string;
  onCreated: (leaf: CategoryGroupOption["children"][number]) => void;
  onPickExisting: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, startSaving] = useTransition();

  const trimmed = name.trim();
  const existing = trimmed ? group.children.find((c) => norm(c.name) === norm(trimmed)) ?? null : null;
  const taken = new Set(group.children.map((c) => norm(c.name)));
  const ideas = (SUGGESTIONS[group.code] ?? []).filter((s) => !taken.has(norm(s)));
  const canSave = !!trimmed && !existing && !saving;

  const close = () => {
    setName("");
    setError("");
    onClose();
  };

  const save = () => {
    if (!canSave) return;
    startSaving(async () => {
      const res = await createCategoryAction({ name: trimmed, parentId: group.id });
      if (!res.ok || !res.id) {
        setError(res.message || `افزودن ${noun} انجام نشد`);
        return;
      }
      onCreated({ id: res.id, code: "", name: trimmed, nature: "cash", description: null });
      close();
    });
  };

  return (
    <Sheet open={open} onClose={close} title={`${noun} جدید`}>
      <div className="ncat" style={{ "--tile": look.color, "--tx": look.color } as React.CSSProperties}>
        <div className="ncat-group">
          <span className="txr-tile-icon" aria-hidden="true">
            <Icon name={look.icon} size={18} />
          </span>
          <span className="ncat-group-text">
            <span className="txr-sub">در گروه</span>
            <b>{group.name}</b>
          </span>
        </div>

        {/* How the new tile will look in the grid. */}
        <div className="ncat-preview" aria-hidden="true">
          <span className="txr-tile" data-on>
            <span className="txr-tick">
              <Icon name="check" size={10} strokeWidth={3} />
            </span>
            <span className="txr-tile-icon">
              <Icon name={look.icon} size={18} />
            </span>
            <span className="txr-tile-label">{trimmed || `نام ${noun}`}</span>
          </span>
        </div>

        <label className="ncat-field">
          <span className="ncat-label">
            نام {noun}
            <span className="num">
              {faCount(name.length)} از {faCount(MAX)}
            </span>
          </span>
          <input
            className="field"
            value={name}
            maxLength={MAX}
            autoComplete="off"
            enterKeyHint="done"
            placeholder={ideas[0] ? `مثلاً ${ideas[0]}` : `نام ${noun}`}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
          />
        </label>

        {ideas.length > 0 && (
          <div className="ncat-ideas">
            <span className="txr-sub">پیشنهاد — با یک لمس</span>
            <div className="txr-tags" role="group" aria-label="نام‌های پیشنهادی">
              {ideas.map((s) => (
                <button key={s} type="button" className="txr-tag" data-on={norm(s) === norm(name) || undefined} onClick={() => setName(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {existing && (
          <div className="txr-note ncat-exists" role="status">
            <span>«{existing.name}» در این گروه هست.</span>
            <button
              type="button"
              className="txr-link"
              onClick={() => {
                onPickExisting(existing.id);
                close();
              }}
            >
              انتخاب همان
            </button>
          </div>
        )}
        {error && (
          <p className="txr-note txr-note-warn" role="alert">
            {error}
          </p>
        )}

        <div className="ncat-actions">
          <button type="button" className="btn btn-ghost" onClick={close}>
            انصراف
          </button>
          <button type="button" className="txr-cta ncat-save" disabled={!canSave} onClick={save}>
            {saving ? "در حال افزودن…" : `افزودن و انتخاب`}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
