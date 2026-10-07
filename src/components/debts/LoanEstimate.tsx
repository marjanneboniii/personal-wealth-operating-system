"use client";
import {useState} from "react";
import {normalizeNumericInput} from "@/lib/numericInput";
import AmountInput from "@/components/ui/AmountInput";
import {estimateLoan} from "@/features/planning/loanEstimate";
import {formatMoney} from "@/lib/format";
export default function LoanEstimate() {
 const [principal,setPrincipal]=useState("");const [rate,setRate]=useState("");const [months,setMonths]=useState("");const [fees,setFees]=useState("0");
 let estimate:ReturnType<typeof estimateLoan>|null=null;
 try {if(principal && rate && months) estimate=estimateLoan(principal,normalizeNumericInput(rate,{decimal:true}),Number(normalizeNumericInput(months)),fees);} catch {}
 return <details className="expense-note"><summary>محاسبه‌گر تخمینی وام</summary><div className="grid gap-3 pt-3 sm:grid-cols-2"><label>اصل وام (تومان)<AmountInput className="field num" value={principal} onValueChange={setPrincipal} unit="toman" /></label><label>نرخ سالانه (%)<input className="field num" inputMode="decimal" value={rate} onChange={e=>setRate(e.target.value)} /></label><label>تعداد ماه<input className="field num" inputMode="numeric" value={months} onChange={e=>setMonths(e.target.value)} /></label><label>کارمزد کسرشده (تومان)<AmountInput className="field num" value={fees} onValueChange={setFees} unit="toman" /></label></div>{estimate && <dl className="mt-3 space-y-2">{([["قسط ماهانه",estimate.monthly],["دریافتی خالص",estimate.netReceived],["جمع بازپرداخت",estimate.total],["هزینه مجموع سود و کارمزد",estimate.cost]]).map(([label,value])=><div key={label} className="flex justify-between gap-2"><dt>{label}</dt><dd>{formatMoney(value,"IRT")}</dd></div>)}</dl>}<p className="muted mt-3 text-xs leading-6">تخمین با اقساط ماهانه مساوی و نرخ ثابت؛ شامل بیمه، جریمه و هزینه‌های اعلام‌نشده نیست. این اعداد برنامه قراردادی را تغییر نمی‌دهند؛ مبلغ قسط قرارداد را در فرم وارد کنید.</p></details>;
}
